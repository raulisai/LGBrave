import Cocoa
import Darwin

// The same supervisor and service as Windows; this process only draws the menu.
struct Config: Decodable { let root: String; let node: String }
struct Status: Decodable {
    struct TV: Decodable { let host: String? }
    struct Web: Decodable { let running: Bool; let built: Bool; let url: String; let friendlyUrl: String }
    let state: String; let label: String; let running: Bool
    let tv: TV?; let app: String?; let host: String?; let error: String?
    let web: Web?
    let actions: [String]?
}

final class App: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var config: Config!
    var status: Status?
    var busy: String?
    var timer: Timer?
    var runningControl = false
    var controlError: String?
    // What the last Doctor or «Usar esta computadora» did, shown for ten minutes.
    var lastActions: [String] = []
    var lastActionsTitle = ""
    var lastActionsAt: Date?
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
                // Taking the TV from the other computer and the Doctor can take longer than a status.
                DispatchQueue.global().asyncAfter(deadline: .now() + (["handoff", "repair"].contains(action) ? 45 : 30), execute: deadline)
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

    func perform(_ action: String, message: String, title: String = "") {
        guard !runningControl, config != nil else { return }
        busy = message; render()
        run(action) { [weak self] status, problem in
            guard let self = self else { return }
            self.busy = nil; self.status = status; self.controlError = problem
            if !title.isEmpty, let actions = status?.actions { self.lastActions = actions; self.lastActionsTitle = title; self.lastActionsAt = Date() }
            self.render()
        }
    }

    // The friendly «.local» name when this Mac has one, else the plain IP address.
    func webAddress(_ web: Status.Web) -> String { web.friendlyUrl.isEmpty ? web.url : web.friendlyUrl }
    func webLine(_ web: Status.Web?) -> String {
        guard let web = web else { return "comprobando…" }
        if !web.built { return "falta generarla (npm run build:all)" }
        return web.running ? webAddress(web) : "apagada"
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
            for line in ["TV: \(s.tv?.host ?? "sin configurar")", "Computadora: \(s.host ?? "sin red")", "Aplicación: \(s.app ?? "en espera")", "Página web: \(webLine(s.web))"] {
                let detail = NSMenuItem(title: line, action: nil, keyEquivalent: "")
                detail.isEnabled = false; menu.addItem(detail)
            }
        }
        if let problem = controlError ?? status?.error, !problem.isEmpty {
            let detail = NSMenuItem(title: String(problem.prefix(180)), action: nil, keyEquivalent: "")
            detail.isEnabled = false; menu.addItem(detail)
        }
        if !lastActions.isEmpty, let at = lastActionsAt, Date().timeIntervalSince(at) < 600 {
            menu.addItem(.separator())
            let heading = NSMenuItem(title: lastActionsTitle, action: nil, keyEquivalent: "")
            heading.isEnabled = false; menu.addItem(heading)
            for line in lastActions {
                let detail = NSMenuItem(title: String(line.prefix(180)), action: nil, keyEquivalent: "")
                detail.isEnabled = false; detail.indentationLevel = 1; menu.addItem(detail)
            }
        }
        menu.addItem(.separator())
        let ready = busy == nil && !runningControl && config != nil
        if status?.state != "connected" {
            let take = NSMenuItem(title: "Usar esta computadora para la TV", action: #selector(useThisComputer), keyEquivalent: "")
            take.target = self; take.isEnabled = ready; menu.addItem(take)
        }
        if let web = status?.web, web.running {
            let open = NSMenuItem(title: "Abrir página web (\(webAddress(web)))", action: #selector(openWebPage), keyEquivalent: "")
            open.target = self; open.isEnabled = true; menu.addItem(open)
        }
        let doctor = NSMenuItem(title: "Doctor: revisar y arreglar", action: #selector(runDoctor), keyEquivalent: "")
        doctor.target = self; doctor.isEnabled = ready; menu.addItem(doctor)
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
    @objc func useThisComputer() { perform("handoff", message: "Pidiendo la TV a la otra computadora…", title: "Usar esta computadora:") }
    @objc func runDoctor() { perform("repair", message: "Doctor revisando…", title: "Doctor:") }
    @objc func openLog() { NSWorkspace.shared.open(URL(fileURLWithPath: config.root + "/.local/logs/desktop.log")) }
    @objc func openWebPage() {
        guard let web = status?.web, let url = URL(string: webAddress(web)) else { return }
        NSWorkspace.shared.open(url)
    }
    @objc func showMenu() { item.button?.performClick(nil) }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
