// Glow Setup for Windows: one double-click installs every Glow app (Glow, GlowLead, GlowChat, GlowRoom)
// and Glow Hands, with no admin rights. It runs the same install-glow.ps1 as the one-line installer
// (the latest from GitHub, or the copy built into this file when offline), shows the progress, then
// offers "Open Glow". It also adds Glow to Settings > Apps so it can be removed like any other app.
//
// Build (Windows, .NET Framework 4 compiler, C# 5):  powershell -File apps/glow/windows/build.ps1
// Switches: /uninstall (remove Glow), /test (silent install of the built-in script without Glow Hands, exit 0 = success).
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace GlowSetup
{
    internal static class Program
    {
        internal const string ScriptUrl = "https://raw.githubusercontent.com/juw12/projects/main/apps/glow/install-glow.ps1";
        internal const string GuideUrl = "https://juw12.github.io/projects/glow/setup/";
        internal const string HomeUrl = "https://juw12.github.io/projects/glow/";
        internal const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Glow";
        internal const string Version = "1.0.0";

        [STAThread]
        private static int Main(string[] args)
        {
            bool uninstall = HasSwitch(args, "/uninstall");
            bool test = HasSwitch(args, "/test");
            if (test)
            {
                return Installer.RunSilentTest();
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm(uninstall));
            return 0;
        }

        private static bool HasSwitch(string[] args, string name)
        {
            foreach (string arg in args)
            {
                if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(arg, "-" + name.Substring(1), StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }
    }

    internal static class Installer
    {
        internal static string GlowFolder
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Glow"); }
        }

        internal static string StartMenuShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Glow", "Glow.lnk"); }
        }

        // The latest installer from GitHub; the copy built into this program when GitHub can't be reached.
        internal static string LoadScript(Action<string> log, bool builtInOnly)
        {
            if (builtInOnly)
            {
                return BuiltInScript();
            }
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
                using (var client = new TimeoutWebClient(20000))
                {
                    client.Encoding = Encoding.UTF8;
                    string script = client.DownloadString(Program.ScriptUrl);
                    if (script.Contains("install-glow-hands.ps1"))
                    {
                        log("Using the latest Glow installer.");
                        return script;
                    }
                }
            }
            catch (Exception error)
            {
                log("Could not download the latest installer (" + error.Message + "); using the built-in copy.");
            }
            return BuiltInScript();
        }

        private static string BuiltInScript()
        {
            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("GlowSetup.install-glow.ps1"))
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        // Runs install-glow.ps1 in a hidden PowerShell and passes each output line to log. Returns the exit code.
        internal static int RunScript(string script, bool withHands, bool desktop, bool remove, Action<string> log)
        {
            string scriptPath = Path.Combine(Path.GetTempPath(), "glow-setup-" + Guid.NewGuid().ToString("N") + ".ps1");
            // Stop on the first error so a failed step is reported as a failure, not a silent success.
            string wrapped = "$ErrorActionPreference = 'Stop'\r\ntry {\r\n" + script + "\r\n} catch { Write-Output ('[Glow] ERROR: ' + $_.Exception.Message); exit 1 }\r\nexit 0\r\n";
            File.WriteAllText(scriptPath, wrapped, new UTF8Encoding(false));
            try
            {
                var start = new ProcessStartInfo("powershell.exe",
                    "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + scriptPath + "\"");
                start.UseShellExecute = false;
                start.CreateNoWindow = true;
                start.RedirectStandardOutput = true;
                start.RedirectStandardError = true;
                start.StandardOutputEncoding = Encoding.UTF8;
                start.StandardErrorEncoding = Encoding.UTF8;
                start.EnvironmentVariables["GLOW_NO_BROWSER"] = "1";
                start.EnvironmentVariables["GLOW_SKIP_HANDS"] = withHands ? "" : "1";
                start.EnvironmentVariables["GLOW_NO_DESKTOP"] = desktop ? "" : "1";
                start.EnvironmentVariables["GLOW_UNINSTALL"] = remove ? "1" : "";
                using (var process = new Process())
                {
                    process.StartInfo = start;
                    process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) log(Clean(e.Data)); };
                    process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (!string.IsNullOrWhiteSpace(e.Data)) log(Clean(e.Data)); };
                    process.Start();
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    process.WaitForExit();
                    return process.ExitCode;
                }
            }
            finally
            {
                try { File.Delete(scriptPath); } catch (IOException) { }
            }
        }

        private static string Clean(string line)
        {
            return line.Replace("[Glow] ", "").Replace("[Glow Hands] ", "Glow Hands: ").TrimEnd();
        }

        // Keeps a copy of this program and lists Glow in Settings > Apps (per user, no admin needed).
        internal static void RegisterUninstall()
        {
            Directory.CreateDirectory(GlowFolder);
            string self = Assembly.GetExecutingAssembly().Location;
            string kept = Path.Combine(GlowFolder, "Glow-Setup.exe");
            if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(kept), StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(self, kept, true);
            }
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Program.UninstallKey))
            {
                key.SetValue("DisplayName", "Glow (GlowLead, GlowChat, GlowRoom, Glow Hands)");
                key.SetValue("DisplayVersion", Program.Version);
                key.SetValue("Publisher", "Glow");
                key.SetValue("DisplayIcon", Path.Combine(GlowFolder, "icons", "Glow.ico"));
                key.SetValue("URLInfoAbout", Program.GuideUrl);
                key.SetValue("InstallLocation", GlowFolder);
                key.SetValue("UninstallString", "\"" + kept + "\" /uninstall");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        internal static void UnregisterAndCleanUp()
        {
            Registry.CurrentUser.DeleteSubKeyTree(Program.UninstallKey, false);
            // This program may itself live in the Glow folder: remove the folder a moment after it exits.
            var cleanup = new ProcessStartInfo("cmd.exe",
                "/c ping -n 3 127.0.0.1 > nul & rmdir /s /q \"" + GlowFolder + "\"");
            cleanup.CreateNoWindow = true;
            cleanup.UseShellExecute = false;
            Process.Start(cleanup);
        }

        internal static int RunSilentTest()
        {
            var output = new StringBuilder();
            Action<string> log = delegate(string line) { lock (output) { output.AppendLine(line); } };
            int code = RunScript(LoadScript(log, true), false, false, false, log);
            Console.Out.Write(output.ToString());
            if (code != 0 || !File.Exists(StartMenuShortcut))
            {
                Console.Out.WriteLine("TEST FAILED (exit " + code + ")");
                return 1;
            }
            RegisterUninstall();
            Console.Out.WriteLine("TEST OK");
            return 0;
        }
    }

    internal sealed class TimeoutWebClient : WebClient
    {
        private readonly int timeout;

        internal TimeoutWebClient(int timeoutMilliseconds)
        {
            timeout = timeoutMilliseconds;
        }

        protected override WebRequest GetWebRequest(Uri address)
        {
            WebRequest request = base.GetWebRequest(address);
            request.Timeout = timeout;
            return request;
        }
    }

    internal sealed class SetupForm : Form
    {
        private static readonly Color Accent = Color.FromArgb(193, 95, 60);
        private static readonly Color Muted = Color.FromArgb(107, 103, 93);

        private readonly bool uninstallMode;
        private readonly Label title = new Label();
        private readonly Label subtitle = new Label();
        private readonly CheckBox handsBox = new CheckBox();
        private readonly CheckBox desktopBox = new CheckBox();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly TextBox logBox = new TextBox();
        private readonly Button primaryButton = new Button();
        private readonly Button secondaryButton = new Button();
        private readonly LinkLabel guideLink = new LinkLabel();
        private bool finished;

        internal SetupForm(bool uninstall)
        {
            uninstallMode = uninstall;
            Text = uninstall ? "Remove Glow" : "Glow Setup";
            Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(250, 249, 245);
            Font = new Font("Segoe UI", 10f);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(560, 430);

            var logo = new PictureBox();
            logo.Image = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location).ToBitmap();
            logo.SizeMode = PictureBoxSizeMode.Zoom;
            logo.SetBounds(28, 24, 48, 48);
            Controls.Add(logo);

            title.Text = uninstall ? "Remove Glow from this PC" : "Set up Glow";
            title.Font = new Font("Segoe UI Semibold", 18f);
            title.AutoSize = true;
            title.Location = new Point(88, 22);
            Controls.Add(title);

            subtitle.Text = uninstall
                ? "Removes the Glow shortcuts and Glow Hands. Your chats and missions stay in your browser."
                : "Installs Glow, GlowLead, GlowChat and GlowRoom (Start menu and desktop) and Glow Hands, so GlowLead can use a web browser for you. No admin rights needed.";
            subtitle.ForeColor = Muted;
            subtitle.SetBounds(90, 62, 440, 60);
            Controls.Add(subtitle);

            handsBox.Text = "Glow Hands: let GlowLead use a browser on this PC (recommended)";
            handsBox.Checked = true;
            handsBox.SetBounds(30, 130, 510, 26);
            desktopBox.Text = "Add shortcuts to the desktop";
            desktopBox.Checked = true;
            desktopBox.SetBounds(30, 158, 510, 26);
            if (!uninstall)
            {
                Controls.Add(handsBox);
                Controls.Add(desktopBox);
            }

            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 0;
            progress.SetBounds(30, 196, 500, 8);
            Controls.Add(progress);

            logBox.Multiline = true;
            logBox.ReadOnly = true;
            logBox.ScrollBars = ScrollBars.Vertical;
            logBox.BackColor = Color.White;
            logBox.Font = new Font("Consolas", 9f);
            logBox.SetBounds(30, 214, 500, 140);
            logBox.Text = uninstall ? "Press Remove to start." : "Press Install to start. It takes about a minute.";
            Controls.Add(logBox);

            guideLink.Text = "Setup guide";
            guideLink.LinkColor = Accent;
            guideLink.AutoSize = true;
            guideLink.Location = new Point(28, 382);
            guideLink.LinkClicked += delegate { OpenUrl(Program.GuideUrl); };
            Controls.Add(guideLink);

            secondaryButton.Text = "Cancel";
            secondaryButton.SetBounds(330, 372, 95, 38);
            secondaryButton.Click += delegate { Close(); };
            Controls.Add(secondaryButton);

            primaryButton.Text = uninstall ? "Remove" : "Install";
            primaryButton.SetBounds(435, 372, 95, 38);
            primaryButton.BackColor = Accent;
            primaryButton.ForeColor = Color.White;
            primaryButton.FlatStyle = FlatStyle.Flat;
            primaryButton.FlatAppearance.BorderSize = 0;
            primaryButton.Click += OnPrimaryClick;
            Controls.Add(primaryButton);
            AcceptButton = primaryButton;
        }

        private void OnPrimaryClick(object sender, EventArgs e)
        {
            if (finished)
            {
                if (uninstallMode)
                {
                    Close();
                }
                else
                {
                    OpenGlow();
                    Close();
                }
                return;
            }
            bool withHands = handsBox.Checked;
            bool desktop = desktopBox.Checked;
            primaryButton.Enabled = false;
            secondaryButton.Enabled = false;
            handsBox.Enabled = false;
            desktopBox.Enabled = false;
            logBox.Clear();
            progress.MarqueeAnimationSpeed = 30;
            var worker = new Thread(delegate() { Work(withHands, desktop); });
            worker.IsBackground = true;
            worker.Start();
        }

        private void Work(bool withHands, bool desktop)
        {
            int code;
            string failure = null;
            try
            {
                string script = Installer.LoadScript(Log, false);
                code = Installer.RunScript(script, withHands, desktop, uninstallMode, Log);
                if (code == 0)
                {
                    if (uninstallMode)
                    {
                        Installer.UnregisterAndCleanUp();
                    }
                    else
                    {
                        Installer.RegisterUninstall();
                    }
                }
            }
            catch (Exception error)
            {
                code = 1;
                failure = error.Message;
            }
            BeginInvoke(new Action(delegate { Done(code, failure); }));
        }

        private void Done(int code, string failure)
        {
            progress.MarqueeAnimationSpeed = 0;
            progress.Style = ProgressBarStyle.Continuous;
            progress.Value = code == 0 ? 100 : 0;
            secondaryButton.Enabled = true;
            primaryButton.Enabled = true;
            if (code == 0)
            {
                finished = true;
                title.Text = uninstallMode ? "Glow is removed" : "Glow is ready";
                subtitle.Text = uninstallMode
                    ? "The shortcuts and Glow Hands are gone. You can close this window."
                    : "Find Glow, GlowLead, GlowChat and GlowRoom in the Start menu and on your desktop. Pin any of them to the taskbar.";
                primaryButton.Text = uninstallMode ? "Close" : "Open Glow";
                primaryButton.Width = 110;
                primaryButton.Left = 420;
                secondaryButton.Text = "Close";
                secondaryButton.Visible = !uninstallMode;
                secondaryButton.Left = 315;
            }
            else
            {
                if (failure != null)
                {
                    Log("Error: " + failure);
                }
                title.Text = "Something went wrong";
                subtitle.Text = "Check your internet connection and press Try again. The setup guide shows other ways to install.";
                primaryButton.Text = "Try again";
                primaryButton.Width = 110;
                primaryButton.Left = 420;
                handsBox.Enabled = true;
                desktopBox.Enabled = true;
            }
        }

        private void Log(string line)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                return;
            }
            if (InvokeRequired)
            {
                BeginInvoke(new Action(delegate { Log(line); }));
                return;
            }
            logBox.AppendText((logBox.TextLength > 0 ? Environment.NewLine : "") + line.Trim());
        }

        private static void OpenGlow()
        {
            if (File.Exists(Installer.StartMenuShortcut))
            {
                Process.Start(new ProcessStartInfo(Installer.StartMenuShortcut) { UseShellExecute = true });
            }
            else
            {
                OpenUrl(Program.HomeUrl);
            }
        }

        private static void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception)
            {
                MessageBox.Show(url, "Open this address in your browser");
            }
        }
    }
}
