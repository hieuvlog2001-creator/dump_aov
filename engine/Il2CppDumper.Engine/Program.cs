using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text;
using Il2CppDumper;
using Newtonsoft.Json;
using static System.Console;

if (args.Length < 3)
{
    Error.WriteLine("Usage: Il2CppDumper.Engine <binary> <global-metadata.dat> <output-dir> [config.json]");
    return 2;
}

var binaryPath = Path.GetFullPath(args[0]);
var metadataPath = Path.GetFullPath(args[1]);
var outputDir = Path.GetFullPath(args[2]);
var configPath = args.Length > 3 ? Path.GetFullPath(args[3]) : Path.Combine(AppContext.BaseDirectory, "config.json");
if (!File.Exists(binaryPath) || !File.Exists(metadataPath))
{
    Error.WriteLine("Input binary or global-metadata.dat was not found.");
    return 2;
}
Directory.CreateDirectory(outputDir);
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

try
{
    var config = File.Exists(configPath)
        ? JsonConvert.DeserializeObject<Config>(File.ReadAllText(configPath)) ?? new Config()
        : new Config();

    WriteLine("Il2CppDumper AoV engine (CLI adapter)");
    WriteLine("Reading metadata...");
    var metadataBytes = File.ReadAllBytes(metadataPath);
    MetadataDecrypter.Decrypt(metadataBytes);
    var metadata = new Metadata(new MemoryStream(metadataBytes));
    WriteLine($"Metadata Version: {metadata.Version}");

    WriteLine("Reading executable...");
    var binaryBytes = File.ReadAllBytes(binaryPath);
    if (binaryBytes.Length < 4) throw new InvalidDataException("Executable is too small.");
    var magic = BitConverter.ToUInt32(binaryBytes, 0);
    var memory = new MemoryStream(binaryBytes);
    Il2Cpp il2cpp;
    switch (magic)
    {
        case 0x6D736100: il2cpp = new WebAssembly(memory).CreateMemory(); break;
        case 0x304F534E: il2cpp = new NSO(memory).UnCompress(); break;
        case 0x905A4D: il2cpp = new PE(memory); break;
        case 0x464c457f:
            il2cpp = binaryBytes[4] == 2 ? new Elf64(memory) : new Elf(memory);
            break;
        case 0xCAFEBABE:
        case 0xBEBAFECA:
            var fat = new MachoFat(new MemoryStream(binaryBytes));
            var slice = int.TryParse(Environment.GetEnvironmentVariable("IL2CPP_MACHO_SLICE"), out var s) ? Math.Max(0, s) : 1;
            slice = Math.Min(slice, fat.fats.Length - 1);
            var selectedMagic = fat.fats[slice].magic;
            var selected = fat.GetMacho(slice);
            memory = new MemoryStream(selected);
            il2cpp = selectedMagic == 0xFEEDFACF ? new Macho64(memory) : new Macho(memory);
            break;
        case 0xFEEDFACF: il2cpp = new Macho64(memory); break;
        case 0xFEEDFACE: il2cpp = new Macho(memory); break;
        default: throw new NotSupportedException($"Unsupported executable magic: 0x{magic:X8}");
    }

    var version = config.ForceIl2CppVersion ? config.ForceVersion : metadata.Version;
    il2cpp.SetProperties(version, metadata.metadataUsagesCount);
    il2cpp.Metadata = metadata;

    if (config.ForceDump || il2cpp.CheckDump())
    {
        if (il2cpp is ElfBase elf)
        {
            var dumpAddress = Environment.GetEnvironmentVariable("IL2CPP_DUMP_ADDRESS");
            if (!string.IsNullOrWhiteSpace(dumpAddress) && ulong.TryParse(dumpAddress,
                    System.Globalization.NumberStyles.HexNumber, null, out var address) && address != 0)
            {
                il2cpp.ImageBase = address;
                il2cpp.IsDumped = true;
                if (!config.NoRedirectedPointer) elf.Reload();
            }
            else il2cpp.IsDumped = true;
        }
    }

    WriteLine("Searching registrations...");
    var found = il2cpp.PlusSearch(metadata.methodDefs.Count(x => x.methodIndex >= 0), metadata.typeDefs.Length, metadata.imageDefs.Length);
    if (!found) found = il2cpp.Search();
    if (!found) found = il2cpp.SymbolSearch();
    if (!found)
    {
        var code = Environment.GetEnvironmentVariable("IL2CPP_CODE_REGISTRATION");
        var meta = Environment.GetEnvironmentVariable("IL2CPP_METADATA_REGISTRATION");
        if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(meta))
            throw new InvalidOperationException("Automatic registration search failed. Set IL2CPP_CODE_REGISTRATION and IL2CPP_METADATA_REGISTRATION (hex) for manual mode.");
        il2cpp.Init(Convert.ToUInt64(code, 16), Convert.ToUInt64(meta, 16));
    }
    if (il2cpp.Version >= 27 && il2cpp.IsDumped && metadata.typeDefs.Length > 0)
    {
        var typeDef = metadata.typeDefs[0];
        var il2cppType = il2cpp.types[typeDef.byvalTypeIndex];
        metadata.ImageBase = il2cppType.data.typeHandle - metadata.header.typeDefinitionsOffset;
    }

    il2cpp.Metadata = metadata;
    var executor = new Il2CppExecutor(metadata, il2cpp);
    if (config.DumpMethod || config.DumpField || config.DumpProperty || config.DumpAttribute)
    {
        WriteLine("Generating dump.cs...");
        new Il2CppDecompiler(executor).Decompile(config, outputDir);
    }
    if (config.GenerateStruct)
    {
        WriteLine("Generating structs and analysis data...");
        var fast = Environment.GetEnvironmentVariable("IL2CPP_FAST_MODE") == "1";
        var threads = Math.Clamp(Environment.ProcessorCount, 1, 8);
        new StructGenerator(executor).WriteScript(outputDir, fast, threads);
    }
    if (config.GenerateDummyDll)
    {
        WriteLine("Generating DummyDll...");
        DummyAssemblyExporter.Export(executor, outputDir, config.DummyDllAddToken);
    }

    var scriptsDir = Path.Combine(AppContext.BaseDirectory, "Scripts");
    if (Directory.Exists(scriptsDir))
        foreach (var file in Directory.GetFiles(scriptsDir))
            File.Copy(file, Path.Combine(outputDir, Path.GetFileName(file)), true);
    WriteLine("DUMP_COMPLETED");
    return 0;
}
catch (Exception ex)
{
    Error.WriteLine(ex);
    return 1;
}
