using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Holy y Luma")]
[assembly: System.Reflection.AssemblyProduct("Holy y Luma")]
[assembly: System.Reflection.AssemblyVersion("0.9.12.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.9.12.0")]

namespace HolyLuma {
  static class Program {
    internal static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory;
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object JsonGate = new object();
    internal static string Serialize(object value) { lock(JsonGate) return Json.Serialize(value); }
    internal static T Deserialize<T>(string value) { lock(JsonGate) return Json.Deserialize<T>(value); }
    internal static void WriteDiagnostic(string file, object value) {
      try { File.WriteAllText(Path.Combine(AppDir,file),Serialize(value)); } catch(IOException) {} catch(UnauthorizedAccessException) {}
    }
    internal static string Root, Node;
    internal static string StartupLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Holy y Luma.lnk"); } }
    internal static string Exe { get { return Path.Combine(AppDir, "HolyLuma.exe"); } }
    internal static bool AutoStart { get { return File.Exists(StartupLink); } }
    internal static void LoginStart(bool enabled) {
      if(enabled) Shortcut(StartupLink);
      else if(File.Exists(StartupLink)) File.Delete(StartupLink);
    }
    static void Shortcut(string path) {
      Directory.CreateDirectory(Path.GetDirectoryName(path));
      dynamic shell = null, link = null;
      try {
        shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")); link = shell.CreateShortcut(path);
        link.TargetPath = Exe; link.Arguments = "--background"; link.WorkingDirectory = AppDir;
        link.Description = "Estado de conexión de Holy y Luma con la TV";
        link.IconLocation = Exe + ",0"; link.Save();
      } finally {
        if(link!=null)Marshal.FinalReleaseComObject(link);if(shell!=null)Marshal.FinalReleaseComObject(shell);
      }
    }
    internal static Dictionary<string,string> UserDirectories() {
      string profile=Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
      string roaming=Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
      string local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
      if(string.IsNullOrWhiteSpace(profile)||string.IsNullOrWhiteSpace(roaming)||string.IsNullOrWhiteSpace(local))
        throw new Exception("Windows no pudo localizar las carpetas de este usuario.");
      return new Dictionary<string,string>{{"USERPROFILE",profile},{"HOME",profile},{"APPDATA",roaming},{"LOCALAPPDATA",local}};
    }
    internal static ProcessStartInfo ControlStartInfo(string action) {
      var info = new ProcessStartInfo(Node, "\"" + Path.Combine(Root,"scripts","desktop-control.mjs") + "\" " + action) {
        WorkingDirectory=Root, UseShellExecute=false, CreateNoWindow=true,
        RedirectStandardOutput=true, RedirectStandardError=true, RedirectStandardInput=true, StandardOutputEncoding=Encoding.UTF8, StandardErrorEncoding=Encoding.UTF8
      };
      // A launcher can inherit temporary or stale application-data directories.
      // Use Windows known folders, including redirected profiles, for every child.
      foreach(var entry in UserDirectories())info.EnvironmentVariables[entry.Key]=entry.Value;
      return info;
    }
    static string RunNode(ProcessStartInfo info,string payload=null) {
      using(var process = Process.Start(info)) {
        var stdout=process.StandardOutput.ReadToEndAsync(); var stderr=process.StandardError.ReadToEndAsync();
        if(payload!=null)process.StandardInput.Write(payload);process.StandardInput.Close();
        if(!process.WaitForExit(30000)) { try{process.Kill();}catch(InvalidOperationException){} throw new Exception("El control tardó demasiado. Revisa el registro."); }
        if(!Task.WaitAll(new Task[]{stdout,stderr},3000))throw new Exception("No se pudo leer la respuesta del control.");
        if(process.ExitCode!=0) throw new Exception(string.IsNullOrWhiteSpace(stderr.Result)?"El control terminó con error "+process.ExitCode+".":stderr.Result.Trim());
        return stdout.Result;
      }
    }
    internal static Dictionary<string,object> Run(string action, string payload = null) {
      return Deserialize<Dictionary<string,object>>(RunNode(ControlStartInfo(action),payload));
    }
    static string VerifyUserEnvironment() {
      var info=ControlStartInfo("status");
      info.Arguments="-e \"console.log(JSON.stringify([process.env.USERPROFILE,process.env.HOME,process.env.APPDATA,process.env.LOCALAPPDATA]))\"";
      var actual=Deserialize<string[]>(RunNode(info));
      var expected=UserDirectories();
      var keys=new[]{"USERPROFILE","HOME","APPDATA","LOCALAPPDATA"};
      if(actual==null||actual.Length!=keys.Length)throw new Exception("Falló la prueba del entorno de Node.");
      for(int i=0;i<keys.Length;i++)
        if(!string.Equals(actual[i],expected[keys[i]],StringComparison.OrdinalIgnoreCase))
          throw new Exception("Node no recibió la carpeta de usuario correcta: "+keys[i]);
      using(var sha=System.Security.Cryptography.SHA256.Create())
        return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(string.Join("|",actual.Select(path=>path.ToUpperInvariant()).ToArray())))).Replace("-","");
    }
    [STAThread] static void Main(string[] args) {
      try {
        if(args.Contains("--stop-for-update")) {
          string installed=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","HolyLuma","HolyLuma.exe");
          foreach(var app in Process.GetProcessesByName("HolyLuma")) using(app) {
            if(app.Id!=Process.GetCurrentProcess().Id && string.Equals(app.MainModule.FileName,installed,StringComparison.OrdinalIgnoreCase)) {app.Kill();app.WaitForExit(5000);}
          }
          return;
        }
        var config=Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(AppDir,"installation.json")));
        Root=config["root"]; Node=config["node"];
        if(!File.Exists(Node) || !File.Exists(Path.Combine(Root,"scripts","desktop-control.mjs"))) throw new Exception("No se encuentra el proyecto o Node.js. Ejecuta de nuevo la instalación de Holy y Luma.");
        if(args.Contains("--install")) {
          Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"Holy y Luma.lnk"));
          LoginStart(!args.Contains("--without-autostart"));
          File.WriteAllText(Path.Combine(AppDir,"installed.json"),Serialize(new {autostart=AutoStart,exe=Exe,at=DateTime.UtcNow.ToString("o")}));
          return;
        }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        if(args.Contains("--self-test")) {
          string environmentHash=VerifyUserEnvironment();
          using(var context=new TrayContext(false)) {
            context.Display(Run("status"));
            File.WriteAllText(Path.Combine(AppDir,"self-test.json"),Serialize(new {ok=true,environmentVerified=true,environmentHash=environmentHash,autostart=AutoStart,at=DateTime.UtcNow.ToString("o")}));
          }
          return;
        }
        bool created;
        using(var mutex=new Mutex(true,"Local\\HolyLumaNativeTray",out created)) {
          if(!created) {
            // The first process may still be constructing its form and event.
            for(int attempt=0;attempt<30;attempt++) {
              try {using(var existing=EventWaitHandle.OpenExisting("Local\\HolyLumaShowStatus"))existing.Set();return;}
              catch(WaitHandleCannotBeOpenedException){Thread.Sleep(100);}
            }
            return;
          }
          using(var context=new TrayContext(true,!args.Contains("--no-start"))) Application.Run(context);
          mutex.ReleaseMutex();
        }
      } catch(Exception error) {
        try{File.WriteAllText(Path.Combine(AppDir,"error.log"),DateTime.UtcNow.ToString("o")+" "+error.Message);}catch(IOException){}catch(UnauthorizedAccessException){}
        if(!args.Contains("--self-test")) MessageBox.Show(error.Message,"Holy y Luma",MessageBoxButtons.OK,MessageBoxIcon.Error);
        Environment.ExitCode=1;
      }
    }
  }
  sealed class TrayContext : ApplicationContext {
    readonly NotifyIcon tray=new NotifyIcon();
    readonly Form form=new Form();
    readonly Label heading=new Label(), address=new Label();
    readonly TextBox details=new TextBox();
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly ToolStripMenuItem statusItem=new ToolStripMenuItem("Iniciando…"), loginItem=new ToolStripMenuItem("Iniciar con Windows");
    readonly EventWaitHandle showEvent;
    readonly Dictionary<string,Icon> icons=new Dictionary<string,Icon>();
    bool busy, quitting, disposed; int ticks; DateTime lastRepair=DateTime.MinValue; string repairText="", repairState="";
    Dictionary<string,object> lastStatus;
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    static Icon MakeIcon(Color color) {
      using(var bitmap=new Bitmap(32,32)) using(var graphics=Graphics.FromImage(bitmap)) {
        graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        graphics.Clear(Color.Transparent);
        using(var brush=new SolidBrush(Color.FromArgb(26,30,42))) graphics.FillEllipse(brush,1,1,30,30);
        using(var font=new Font("Segoe UI",12,FontStyle.Bold,GraphicsUnit.Pixel)) graphics.DrawString("LG",font,Brushes.White,5,7);
        using(var brush=new SolidBrush(color)) graphics.FillEllipse(brush,22,22,10,10);
        var handle=bitmap.GetHicon(); try {return (Icon)Icon.FromHandle(handle).Clone();} finally {DestroyIcon(handle);}
      }
    }
    internal TrayContext(bool visible, bool startConnection = true) {
      icons["green"]=MakeIcon(Color.FromArgb(67,211,130)); icons["amber"]=MakeIcon(Color.FromArgb(255,186,56)); icons["red"]=MakeIcon(Color.FromArgb(240,85,95));
      form.Text="Holy y Luma · Estado de conexión"; form.ClientSize=new Size(650,440); form.MinimumSize=new Size(666,479);
      form.StartPosition=FormStartPosition.CenterScreen; form.Font=new Font("Segoe UI",10); form.Icon=icons["amber"];
      heading.SetBounds(24,24,602,60); heading.Font=new Font("Segoe UI",17,FontStyle.Bold);
      address.SetBounds(24,89,602,60);
      details.SetBounds(24,159,602,188); details.Multiline=true; details.ReadOnly=true; details.ScrollBars=ScrollBars.Vertical; details.BorderStyle=BorderStyle.None; details.BackColor=form.BackColor;
      form.Controls.AddRange(new Control[]{heading,address,details});
      int x=24;
      foreach(var item in new[]{new[]{"Encender","start"},new[]{"Apagar","stop"},new[]{"Reiniciar","restart"},new[]{"Doctor · Reparar","repair"}}) {
        string action=item[1]; var button=new Button {Text=item[0]}; button.SetBounds(x,371,140,38);button.Click+=async (s,e)=>await Execute(action);form.Controls.Add(button);x+=154;
      }
      form.FormClosing+=(s,e)=>{if(!quitting && e.CloseReason==CloseReason.UserClosing){e.Cancel=true;form.Hide();}};
      var menu=new ContextMenuStrip(); statusItem.Enabled=false; menu.Items.Add(statusItem); menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("Ver estado",null,(s,e)=>ShowPanel());
      menu.Items.Add("Encender conexión",null,async(s,e)=>await Execute("start"));
      menu.Items.Add("Apagar conexión",null,async(s,e)=>await Execute("stop"));
      menu.Items.Add("Reiniciar conexión",null,async(s,e)=>await Execute("restart"));
      menu.Items.Add("Usar esta computadora para la TV",null,async(s,e)=>{ShowPanel();await Execute("handoff");});
      menu.Items.Add("Abrir página web",null,(s,e)=>{
        var web=lastStatus!=null&&lastStatus.ContainsKey("web")?lastStatus["web"] as Dictionary<string,object>:null;
        if(web==null||!Convert.ToBoolean(web["running"])){MessageBox.Show("La página web (el catálogo para cualquier teléfono, tablet o laptop de tu wifi) aún no está activa.","Página web");return;}
        string url=web["friendlyUrl"].ToString();if(string.IsNullOrEmpty(url))url=web["url"].ToString();
        Process.Start(new ProcessStartInfo(url){UseShellExecute=true});
      });
      menu.Items.Add("Doctor · Reparar conexión",null,async(s,e)=>{ShowPanel();await Execute("repair");});
      menu.Items.Add("Ver diagnóstico",null,async(s,e)=>{ShowPanel();await Execute("doctor");});
      menu.Items.Add("Configurar direcciones",null,async(s,e)=>{try{await Configure();}catch(Exception error){MessageBox.Show(error.Message,"Configurar conexión");}});
      menu.Items.Add("Vincular TV",null,(s,e)=>{
        Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"WindowsPowerShell","v1.0","powershell.exe"),
          "-NoProfile -ExecutionPolicy Bypass -STA -File \""+Path.Combine(Program.Root,"windows","Link-TV.ps1")+"\""){UseShellExecute=true});
      });
      menu.Items.Add("Ver registro",null,(s,e)=>OpenLog());
      menu.Items.Add(new ToolStripSeparator());
      loginItem.Checked=Program.AutoStart;
      loginItem.Click+=(s,e)=>{try{Program.LoginStart(!Program.AutoStart);loginItem.Checked=Program.AutoStart;}catch(Exception error){MessageBox.Show(error.Message,"Inicio automático");}};
      menu.Items.Add(loginItem);
      menu.Items.Add("Salir del icono (mantener conexión)",null,(s,e)=>{quitting=true;ExitThread();});
      menu.Items.Add("Apagar todo y salir",null,async(s,e)=>{if(busy)return;if(await Execute("stop")){quitting=true;ExitThread();}});
      tray.ContextMenuStrip=menu;tray.Icon=icons["amber"];tray.Text="Holy y Luma · Iniciando";tray.DoubleClick+=(s,e)=>ShowPanel();tray.Visible=visible;
      showEvent=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\HolyLumaShowStatus");
      timer.Interval=1000;
      timer.Tick+=async(s,e)=>{if(showEvent.WaitOne(0))ShowPanel();if(++ticks%4==0){await Execute("status");if(lastStatus!=null&&!busy&&DateTime.UtcNow-lastRepair>TimeSpan.FromSeconds(60)){string state=lastStatus["state"].ToString();bool mismatch=lastStatus.ContainsKey("repairNeeded")&&Convert.ToBoolean(lastStatus["repairNeeded"]);if(mismatch||state=="unresponsive"||state=="error"){lastRepair=DateTime.UtcNow;await Execute("repair");}}}};
      if(visible){timer.Start(); var initial=Execute(startConnection?"start":"status");}
    }
    void ShowPanel(){form.Show();form.WindowState=FormWindowState.Normal;form.Activate();}
    void OpenLog(){var path=Path.Combine(Program.Root,".local","logs","desktop.log");if(File.Exists(path))Process.Start(new ProcessStartInfo("notepad.exe","\""+path+"\""){UseShellExecute=true});}
    async Task<bool> Execute(string action, string payload = null) {
      if(busy || quitting || disposed)return false;busy=true;
      try{var result=await Task.Run(()=>Program.Run(action,payload));if(!disposed&&!quitting){if(action=="repair")lastRepair=DateTime.UtcNow;if((action=="repair"||action=="handoff")&&result.ContainsKey("actions")){repairState=result.ContainsKey("state")?result["state"].ToString():"";var items=result["actions"] as System.Collections.IEnumerable;repairText=items==null?"":(action=="repair"?"Doctor: ":"Usar esta computadora: ")+string.Join(Environment.NewLine,items.Cast<object>().Select(x=>x.ToString()));}Display(result);}return true;}
      catch(Exception error){if(!disposed&&!quitting){heading.Text="No se pudo consultar el estado";details.Text=error.Message;statusItem.Text="Revisar conexión";tray.Icon=icons["red"];tray.Text="Holy y Luma · Revisar conexión";}return false;}
      finally{busy=false;}
    }
    async Task Configure() {
      if(busy || lastStatus==null)return;
      var config=lastStatus["config"] as Dictionary<string,object>;
      using(var dialog=new Form {Text="Configurar conexión",ClientSize=new Size(520,310),StartPosition=FormStartPosition.CenterScreen,Font=form.Font}) {
        string[] keys={"device","tvIp","host","peers"};string[] labels={"Perfil webOS","IP actual de la TV","IP de esta computadora (vacío = automática)","Otras computadoras (separadas por coma)"};var boxes=new List<TextBox>();
        for(int i=0;i<keys.Length;i++) {
          var label=new Label {Text=labels[i]};label.SetBounds(16,12+i*60,488,22);dialog.Controls.Add(label);
          object entry=config[keys[i]];string text=keys[i]=="peers"?string.Join(",",((System.Collections.IEnumerable)entry).Cast<object>().Select(x=>x.ToString())):entry.ToString();
          var box=new TextBox {Text=text};box.SetBounds(16,34+i*60,488,25);dialog.Controls.Add(box);boxes.Add(box);
        }
        var save=new Button {Text="Guardar",DialogResult=DialogResult.OK};save.SetBounds(364,263,140,32);dialog.Controls.Add(save);dialog.AcceptButton=save;
        if(dialog.ShowDialog()==DialogResult.OK) {
          var updated=new {device=boxes[0].Text.Trim(),tvIp=boxes[1].Text.Trim(),host=boxes[2].Text.Trim(),peers=boxes[3].Text.Split(',').Select(x=>x.Trim()).Where(x=>x!="").ToArray()};
          if(await Execute("configure",Program.Serialize(updated)))await Execute("restart");
        }
      }
    }
    internal void Display(Dictionary<string,object> data) {
      lastStatus=data;
      Func<string,string> value=key=>data.ContainsKey(key)&&data[key]!=null?data[key].ToString():"";
      string state=value("state"),label=value("label");
      if(repairState!=state)repairText="";
      bool waiting=state=="standby"||state=="waiting"||state=="starting"||state=="restarting";
      string tone=state=="connected"?"green":waiting?"amber":"red";
      tray.Icon=icons[tone];form.Icon=icons[tone];heading.ForeColor=tone=="green"?Color.ForestGreen:tone=="amber"?Color.DarkGoldenrod:Color.Firebrick;
      heading.Text=label;statusItem.Text=label;
      string tooltip="Holy y Luma · "+label;tray.Text=tooltip.Substring(0,Math.Min(63,tooltip.Length));
      var tv=data.ContainsKey("tv")?data["tv"] as Dictionary<string,object>:null;
      var web=data.ContainsKey("web")?data["web"] as Dictionary<string,object>:null;
      string webLine;
      if(web==null)webLine="comprobando…";
      else if(!Convert.ToBoolean(web["built"]))webLine="falta generarla (npm run build:all)";
      else if(!Convert.ToBoolean(web["running"]))webLine="apagada";
      else{string wUrl=web["friendlyUrl"].ToString();webLine=string.IsNullOrEmpty(wUrl)?web["url"].ToString():wUrl;}
      address.Text="Computadora: "+value("host")+"     TV: "+(tv!=null?tv["host"].ToString():"")+Environment.NewLine+"Aplicación: "+value("app")+Environment.NewLine+"Página web: "+webLine;
      var lines=new List<string>();if(repairText!="")lines.Add(repairText);if(value("error")!="")lines.Add(value("error"));
      if(data.ContainsKey("checks")){var checks=data["checks"] as System.Collections.IEnumerable;if(checks!=null)foreach(var check in checks)lines.Add(check.ToString());}
      lines.Add("");lines.Add("Inicio automático con Windows: "+(Program.AutoStart?"Activado":"Desactivado"));
      lines.Add("Cerrar esta ventana mantiene la conexión en segundo plano.");
      lines.Add("");lines.Add(value("history"));details.Text=string.Join(Environment.NewLine,lines.Distinct());
      loginItem.Checked=Program.AutoStart;
      Program.WriteDiagnostic("tray-status.json",new {pid=Process.GetCurrentProcess().Id,state=state,label=label,autostart=Program.AutoStart,updated=DateTime.UtcNow.ToString("o")});
    }
    protected override void Dispose(bool disposing) {
      if(disposing&&!disposed){disposed=true;timer.Stop();timer.Dispose();tray.Visible=false;tray.Dispose();form.Dispose();showEvent.Dispose();foreach(var icon in icons.Values)icon.Dispose();}
      base.Dispose(disposing);
    }
  }
}
