// A throwaway text box for end-to-end tests: shows a focused TextBox, optionally
// pre-filled and selected, then writes whatever is in it to a file and exits.
// Usage: TestPad.exe <outFile> <seconds> [initialText]
using System;
using System.IO;
using System.Windows.Forms;

class TestPad : Form
{
    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.Run(new TestPad(args));
    }

    TestPad(string[] args)
    {
        Text = "Purr TestPad";
        Width = 760;
        Height = 320;
        TopMost = true;
        StartPosition = FormStartPosition.CenterScreen;
        var box = new TextBox { Multiline = true, Dock = DockStyle.Fill, Font = new System.Drawing.Font("Segoe UI", 12), AcceptsReturn = true };
        Controls.Add(box);
        string outFile = args[0];
        int seconds = int.Parse(args[1]);
        string initial = args.Length > 2 ? args[2] : "";
        box.Text = initial;
        Shown += (s, e) =>
        {
            Activate();
            box.Focus();
            if (initial.Length > 0) box.SelectAll();
        };
        var timer = new Timer { Interval = seconds * 1000 };
        timer.Tick += (s, e) =>
        {
            File.WriteAllText(outFile, box.Text);
            Close();
        };
        timer.Start();
    }
}
