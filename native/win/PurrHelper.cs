// Purr native helper for Windows. Compiled with the C# compiler that ships with
// .NET Framework 4 (csc.exe), so no SDK is needed. C# 5 syntax only.
//
// Does what Node can't:
//  - a low-level keyboard hook that can SWALLOW the last key of a Purr shortcut,
//    so Win+Alt+1 doesn't also open a jump list and Ctrl+Win+Space doesn't switch layouts,
//    and masks the Win/Alt key-up so the Start menu / menu bar don't pop open;
//  - reads the focused text field (UI Automation) so Purr can learn corrected words.
//
// Protocol (stdin, tab separated):  cmd \t id \t arg
//   chords  0 Ctrl+Meta|Ctrl+Meta+Space|Meta+Alt+1     shortcuts to watch
//   esc     0 1|0                                      swallow Escape (only during a dictation)
//   pause   0 1|0                                      stop matching (while recording a new shortcut)
//   focused <id>                                       -> {"id":..,"value":..,"selection":..}
//   quit
// Output (stdout, JSON lines): {"e":"hook","ok":true}  {"e":"kd","k":"CtrlLeft"}  {"e":"ku","k":"CtrlLeft"}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

static class PurrHelper
{
    const int WH_KEYBOARD_LL = 13;
    const int WH_MOUSE_LL = 14;
    const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105;
    const int WM_MBUTTONDOWN = 0x0207, WM_MBUTTONUP = 0x0208, WM_XBUTTONDOWN = 0x020B, WM_XBUTTONUP = 0x020C;
    const uint LLKHF_INJECTED = 0x10, LLKHF_EXTENDED = 0x01;
    const byte VK_MASK = 0xE8; // unassigned; used to mask Win/Alt releases

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct MSLLHOOKSTRUCT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

    static HookProc keyProc = KeyHook;   // keep delegates alive
    static HookProc mouseProc = MouseHook;
    static IntPtr keyHook, mouseHook;

    static readonly object outLock = new object();
    static readonly Queue<string> outQueue = new Queue<string>();
    static readonly AutoResetEvent outSignal = new AutoResetEvent(false);

    static List<string[]> chords = new List<string[]>();
    static readonly HashSet<string> pressed = new HashSet<string>();
    static readonly HashSet<string> swallowedDown = new HashSet<string>();
    static volatile bool swallowEsc = false;
    static volatile bool paused = false;
    static bool chordUsedWin = false, chordUsedAlt = false;

    static void Emit(string json)
    {
        lock (outLock) outQueue.Enqueue(json);
        outSignal.Set();
    }

    static void Writer()
    {
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        stdout.AutoFlush = true;
        while (true)
        {
            outSignal.WaitOne();
            while (true)
            {
                string line = null;
                lock (outLock) { if (outQueue.Count > 0) line = outQueue.Dequeue(); }
                if (line == null) break;
                try { stdout.WriteLine(line); } catch { Environment.Exit(0); }
            }
        }
    }

    static string Esc(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            if (c == '"') sb.Append("\\\"");
            else if (c == '\\') sb.Append("\\\\");
            else if (c == '\n') sb.Append("\\n");
            else if (c == '\r') sb.Append("\\r");
            else if (c == '\t') sb.Append("\\t");
            else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.ToString();
    }

    // Names match uiohook-napi's so recorded shortcuts work with either backend.
    static string KeyName(uint vk, uint flags)
    {
        switch (vk)
        {
            case 0xA2: return "CtrlLeft";
            case 0xA3: return "CtrlRight";
            case 0xA4: return "AltLeft";
            case 0xA5: return "AltRight";
            case 0xA0: return "ShiftLeft";
            case 0xA1: return "ShiftRight";
            case 0x5B: return "MetaLeft";
            case 0x5C: return "MetaRight";
            case 0x11: return (flags & LLKHF_EXTENDED) != 0 ? "CtrlRight" : "CtrlLeft";
            case 0x12: return (flags & LLKHF_EXTENDED) != 0 ? "AltRight" : "AltLeft";
            case 0x10: return "ShiftLeft";
            case 0x20: return "Space";
            case 0x1B: return "Escape";
            case 0x0D: return (flags & LLKHF_EXTENDED) != 0 ? "NumpadEnter" : "Enter";
            case 0x09: return "Tab";
            case 0x08: return "Backspace";
            case 0x14: return "CapsLock";
            case 0x2D: return "Insert";
            case 0x2E: return "Delete";
            case 0x24: return "Home";
            case 0x23: return "End";
            case 0x21: return "PageUp";
            case 0x22: return "PageDown";
            case 0x25: return "ArrowLeft";
            case 0x26: return "ArrowUp";
            case 0x27: return "ArrowRight";
            case 0x28: return "ArrowDown";
            case 0xBA: return "Semicolon";
            case 0xBB: return "Equal";
            case 0xBC: return "Comma";
            case 0xBD: return "Minus";
            case 0xBE: return "Period";
            case 0xBF: return "Slash";
            case 0xC0: return "Backquote";
            case 0xDB: return "BracketLeft";
            case 0xDC: return "Backslash";
            case 0xDD: return "BracketRight";
            case 0xDE: return "Quote";
            case 0x2C: return "PrintScreen";
            case 0x91: return "ScrollLock";
            case 0x90: return "NumLock";
        }
        if (vk >= 0x30 && vk <= 0x39) return ((char)vk).ToString();
        if (vk >= 0x41 && vk <= 0x5A) return ((char)vk).ToString();
        if (vk >= 0x70 && vk <= 0x87) return "F" + (vk - 0x6F);
        if (vk >= 0x60 && vk <= 0x69) return "Numpad" + (vk - 0x60);
        return "Key" + vk;
    }

    static bool IsModifier(string k)
    {
        return k.StartsWith("Ctrl") || k.StartsWith("Alt") || k.StartsWith("Shift") || k.StartsWith("Meta");
    }

    static bool Satisfies(string binding, string key)
    {
        if (binding == key) return true;
        if (key.EndsWith("Left") || key.EndsWith("Right"))
        {
            string generic = key.Replace("Left", "").Replace("Right", "");
            return generic == binding;
        }
        return false;
    }

    // Exactly this chord is down.
    static bool Exact(string[] chord, HashSet<string> keys)
    {
        if (chord.Length != keys.Count) return false;
        var pool = new List<string>(keys);
        foreach (var b in chord)
        {
            int i = pool.FindIndex(p => Satisfies(b, p));
            if (i < 0) return false;
            pool.RemoveAt(i);
        }
        return true;
    }

    static IntPtr KeyHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var kb = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            // Injected keys count too (PowerToys / AutoHotkey remaps); only our own mask key is skipped.
            if (kb.vkCode != VK_MASK)
            {
                int msg = wParam.ToInt32();
                bool down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
                bool up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
                string name = KeyName(kb.vkCode, kb.flags);
                if (down)
                {
                    bool repeat = pressed.Contains(name);
                    pressed.Add(name);
                    if (!repeat) Emit("{\"e\":\"kd\",\"k\":\"" + name + "\"}");
                    if (swallowedDown.Contains(name)) return (IntPtr)1; // auto-repeat of a swallowed key
                    if (!paused)
                    {
                        if (name == "Escape" && swallowEsc) { swallowedDown.Add(name); return (IntPtr)1; }
                        foreach (var c in chords)
                        {
                            if (!Exact(c, pressed)) continue;
                            bool hasWin = false, hasAlt = false;
                            foreach (var k in c) { if (k.StartsWith("Meta")) hasWin = true; if (k.StartsWith("Alt")) hasAlt = true; }
                            chordUsedWin |= hasWin;
                            chordUsedAlt |= hasAlt;
                            // Swallow the key that completes the chord unless it's a modifier.
                            if (!IsModifier(name)) { swallowedDown.Add(name); return (IntPtr)1; }
                            break;
                        }
                    }
                }
                else if (up)
                {
                    pressed.Remove(name);
                    Emit("{\"e\":\"ku\",\"k\":\"" + name + "\"}");
                    if (swallowedDown.Remove(name)) return (IntPtr)1;
                    // Releasing Win alone opens Start; releasing Alt alone focuses the menu bar.
                    // A dummy key press in between tells Windows "this was a combination".
                    if ((name.StartsWith("Meta") && chordUsedWin) || (name.StartsWith("Alt") && chordUsedAlt))
                    {
                        keybd_event(VK_MASK, 0, 0, UIntPtr.Zero);
                        keybd_event(VK_MASK, 0, 2, UIntPtr.Zero);
                    }
                    if (pressed.Count == 0) { chordUsedWin = false; chordUsedAlt = false; }
                }
            }
        }
        return CallNextHookEx(keyHook, nCode, wParam, lParam);
    }

    static IntPtr MouseHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            if (msg == WM_MBUTTONDOWN || msg == WM_MBUTTONUP || msg == WM_XBUTTONDOWN || msg == WM_XBUTTONUP)
            {
                var ms = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                string name = msg == WM_MBUTTONDOWN || msg == WM_MBUTTONUP ? "Mouse3" : (((ms.mouseData >> 16) & 0xFFFF) == 1 ? "Mouse4" : "Mouse5");
                bool down = msg == WM_MBUTTONDOWN || msg == WM_XBUTTONDOWN;
                Emit("{\"e\":\"" + (down ? "kd" : "ku") + "\",\"k\":\"" + name + "\"}");
                // A side button used as push-to-talk shouldn't also make the browser go back.
                if (!paused)
                {
                    foreach (var c in chords) if (c.Length == 1 && c[0] == name) return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(mouseHook, nCode, wParam, lParam);
    }

    static string Focused(string id)
    {
        string value = "", selection = "", control = "";
        var t = new Thread(() =>
        {
            try
            {
                var el = AutomationElement.FocusedElement;
                if (el == null) return;
                control = el.Current.ControlType.ProgrammaticName;
                if (el.Current.IsPassword) return;
                object p;
                if (el.TryGetCurrentPattern(TextPattern.Pattern, out p))
                {
                    var tp = (TextPattern)p;
                    value = tp.DocumentRange.GetText(8000);
                    var sel = tp.GetSelection();
                    if (sel != null && sel.Length > 0) selection = sel[0].GetText(4000);
                }
                else if (el.TryGetCurrentPattern(ValuePattern.Pattern, out p))
                {
                    value = ((ValuePattern)p).Current.Value ?? "";
                }
            }
            catch { }
        });
        t.SetApartmentState(ApartmentState.MTA);
        t.IsBackground = true;
        t.Start();
        t.Join(700);
        if (value.Length > 8000) value = value.Substring(0, 8000);
        return "{\"id\":\"" + id + "\",\"value\":\"" + Esc(value) + "\",\"selection\":\"" + Esc(selection) + "\",\"control\":\"" + Esc(control) + "\"}";
    }

    static void Reader()
    {
        var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            var parts = line.Split('\t');
            string cmd = parts[0];
            string id = parts.Length > 1 ? parts[1] : "0";
            string arg = parts.Length > 2 ? parts[2] : "";
            if (cmd == "chords")
            {
                var list = new List<string[]>();
                foreach (var c in arg.Split('|')) if (c.Length > 0) list.Add(c.Split('+'));
                chords = list;
            }
            else if (cmd == "esc") swallowEsc = arg == "1";
            else if (cmd == "pause") paused = arg == "1";
            else if (cmd == "focused") { string r = Focused(id); Emit(r); }
            else if (cmd == "ping") Emit("{\"id\":\"" + id + "\",\"ok\":true}");
            else if (cmd == "quit") Environment.Exit(0);
        }
        Environment.Exit(0); // parent closed our stdin: Purr quit
    }

    [STAThread]
    static void Main()
    {
        new Thread(Writer) { IsBackground = true }.Start();
        new Thread(Reader) { IsBackground = true }.Start();
        IntPtr mod = GetModuleHandle(null);
        keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, mod, 0);
        mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, mod, 0);
        Emit("{\"e\":\"hook\",\"ok\":" + (keyHook != IntPtr.Zero ? "true" : "false") + "}");
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }
}
