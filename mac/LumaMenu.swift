import Cocoa
import Darwin

// The same supervisor and service as Windows; this process only draws the menu.
struct Config: Decodable { let root: String; let node: String }
struct Status: Decodable {
    struct TV: Decodable { let host: String? }
    let state: String; let label: String; let running: Bool
    let tv: TV?; let app: String?; let host: String?; let error: String?
}

final class App: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var config: Config!
    var status: Status?
    var busy: String?
    var timer: Timer?
    var runningControl = false
    var controlError: String?
    let showNotification = NSNotification.Name("com.lgapp.lab.menu.show")
    var instanceLock: Int32 = -1

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("HolyLuma")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
            instanceLock = open(directory.appendingPathComponent("menu.lock").path, O_CREAT | O_RDWR, mode_t(0o600))
            if instanceLock < 0 { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            if flock(instanceLock, LOCK_EX | LOCK_NB) != 0 {
                close(instanceLock); instanceLock = -1
                DistributedNotificationCenter.default().postNotificationName(showNotification, object: nil, userInfo: nil, deliverImmediately: true)
                NSApp.terminate(nil); return
            }
        } catch {
            controlError = "No se pudo abrir el control: \(error.localizedDescription)"
            render(); return
        }
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(showMenu), name: showNotification, object: nil)
        guard let url = Bundle.main.url(forResource: "config", withExtension: "json"),
              let data = try? Data(contentsOf: url), let cfg = try? JSONDecoder().decode(Config.self, from: data) else {
            controlError = "Falta la configuración. Ejecuta mac/build.sh de nuevo."
            render(); return
        }
        config = cfg
        perform("start", message: "Iniciando conexión…")
        timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in self?.poll() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        DistributedNotificationCenter.default().removeObserver(self)
        if instanceLock >= 0 { close(instanceLock); instanceLock = -1 }
    }

    func run(_ action: String, completion: @escaping (Status?, String?) -> Void) {
        guard !runningControl, config != nil else { return }
        runningControl = true
        let cfg = config!
        DispatchQueue.global(qos: .utility).async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: cfg.node)
            process.arguments = [cfg.root + "/scripts/desktop-control.mjs", action]
            process.currentDirectoryURL = URL(fileURLWithPath: cfg.root)
            let pipe = Pipe(); process.standardOutput = pipe; process.standardError = pipe
            process.standardInput = FileHandle.nullDevice
            var result: Status?
            var problem: String?
            do {
                try process.run()
                let deadline = DispatchWorkItem {
                    if process.isRunning {
                        process.terminate()
                        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                        }
                    }
                }
                DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: deadline)
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit(); deadline.cancel()
                let output = String(data: data, encoding: .utf8) ?? ""
                if process.terminationStatus == 0, let line = output.split(separator: "\n").last {
                    result = try? JSONDecoder().decode(Status.self, from: Data(line.utf8))
                }
                if result == nil {
                    problem = output.trimmingCharacters(in: .whitespacesAndNewlines)
                    if problem?.isEmpty != false { problem = "El control no respondió. Revisa Node.js, la ruta del proyecto y el registro." }
                }
            } catch { problem = error.localizedDescription }
            let finalResult = result, finalProblem = problem
            DispatchQueue.main.async {
                self.runningControl = false
                completion(finalResult, finalProblem)
            }
        }
    }

    func poll() {
        guard busy == nil, !runningControl else { return }
        run("status") { [weak self] status, problem in
            self?.status = status; self?.controlError = problem; self?.render()
        }
    }

    func perform(_ action: String, message: String) {
        guard !runningControl, config != nil else { return }
        busy = message; render()
        run(action) { [weak self] status, problem in
            self?.busy = nil; self?.status = status; self?.controlError = problem; self?.render()
        }
    }

    func color(for state: String?) -> NSColor {
        if controlError != nil { return .systemRed }
        switch state {
        case "connected": return .systemGreen
        case "waiting", "starting", "running", "standby", "restarting": return .systemOrange
        case "offline", "error", "setup", "conflict", "unresponsive": return .systemRed
        default: return .systemGray
        }
    }

    func render() {
        let dot = busy != nil ? NSColor.systemYellow : color(for: status?.state)
        let title = NSMutableAttributedString(string: "● ", attributes: [.foregroundColor: dot, .font: NSFont.systemFont(ofSize: 12)])
        title.append(NSAttributedString(string: "LG", attributes: [.font: NSFont.menuBarFont(ofSize: 0)]))
        item.button?.attributedTitle = title
        item.button?.toolTip = busy ?? controlError ?? status?.label ?? "Holy y Luma · LG"

        let menu = NSMenu()
        let headline = NSMenuItem(title: busy ?? (controlError != nil ? "Revisar conexión" : status?.label) ?? "Comprobando…", action: nil, keyEquivalent: "")
        headline.isEnabled = false
        menu.addItem(headline)
        if let s = status {
            for line in ["TV: \(s.tv?.host ?? "sin configurar")", "Computadora: \(s.host ?? "sin red")", "Aplicación: \(s.app ?? "en espera")"] {
                let detail = NSMenuItem(title: line, action: nil, keyEquivalent: "")
                detail.isEnabled = false; menu.addItem(detail)
            }
        }
        if let problem = controlError ?? status?.error, !problem.isEmpty {
            let detail = NSMenuItem(title: String(problem.prefix(180)), action: nil, keyEquivalent: "")
            detail.isEnabled = false; menu.addItem(detail)
        }
        menu.addItem(.separator())
        let on = status?.running == true
        let toggle = NSMenuItem(title: on ? "Apagar conexión" : "Encender conexión", action: #selector(toggleConnection), keyEquivalent: "")
        toggle.target = self; toggle.isEnabled = busy == nil && !runningControl && config != nil; menu.addItem(toggle)
        if on {
            let restart = NSMenuItem(title: "Reiniciar conexión", action: #selector(restartConnection), keyEquivalent: "")
            restart.target = self; restart.isEnabled = busy == nil && !runningControl && config != nil; menu.addItem(restart)
        }
        menu.addItem(.separator())
        let log = NSMenuItem(title: "Ver registro", action: #selector(openLog), keyEquivalent: "")
        log.target = self; log.isEnabled = config != nil; menu.addItem(log)
        let quit = NSMenuItem(title: "Salir del menú (mantener conexión)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        item.menu = menu
    }

    @objc func toggleConnection() {
        if status?.running == true { perform("stop", message: "Apagando…") } else { perform("start", message: "Encendiendo…") }
    }
    @objc func restartConnection() { perform("restart", message: "Reiniciando…") }
    @objc func openLog() { NSWorkspace.shared.open(URL(fileURLWithPath: config.root + "/.local/logs/desktop.log")) }
    @objc func showMenu() { item.button?.performClick(nil) }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
