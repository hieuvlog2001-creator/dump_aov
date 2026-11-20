// Minimal compatibility shims for the original core's logging-only WPF references.
namespace System.Windows.Media
{
    public sealed class Brush { private Brush() { } }
    public static class Brushes
    {
        public static readonly Brush Orange = new();
        public static readonly Brush Yellow = new();
    }
}
namespace Il2CppDumper
{
    public sealed class MainForm
    {
        public static void Log(string message, params object?[] args)
        {
            try { Console.WriteLine(args.Length == 0 ? message : string.Format(message, args)); }
            catch { Console.WriteLine(message); }
        }
        public static void Log(string message, System.Windows.Media.Brush brush) => Console.WriteLine(message);
    }
}
