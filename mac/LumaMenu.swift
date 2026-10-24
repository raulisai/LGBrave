import Cocoa

// Menu-bar status and one-click control for the Mac side of Luma. All logic lives in
// scripts/luma-control.mjs (shared with the future Windows tray); this only draws it.
struct Config: Decodable { let root: String; let node: String }
struct Status: Decodable {
    let state: String; let label: String; let lab: Bool; let server: Bool; let tvReachable: Bool; let tvIp: String
}

final class App: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var config: Config!
    var status: Status?
    var busy: String?
    var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let url = Bundle.main.url(forResource: "config", withExtension: "json"),
              let data = try? Data(contentsOf: url), let cfg = try? JSONDecoder().decode(Config.self, from: data) else {
            item.button?.title = "LG ⚠︎"; return
        }
        config = cfg
        render()
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.poll() }
    }

    func run(_ action: String, completion: @escaping (Status?) -> Void) {
        DispatchQueue.global().async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: self.config.node)
            process.arguments = [self.config.root + "/scripts/luma-control.mjs", action]
            process.currentDirectoryURL = URL(fileURLWithPath: self.config.root)
            let pipe = Pipe(); process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
            var result: Status?
            do {
                try process.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                if let line = String(data: data, encoding: .utf8)?.split(separator: "\n").last {
                    result = try? JSONDecoder().decode(Status.self, from: Data(line.utf8))
                }
            } catch { result = nil }
            DispatchQueue.main.async { completion(result) }
        }
    }

    func poll() {
        guard busy == nil else { return }
        run("status") { [weak self] status in self?.status = status; self?.render() }
    }

    func perform(_ action: String, message: String) {
        busy = message; render()
        run(action) { [weak self] status in
            self?.busy = nil
            if let status = status { self?.status = status }
            self?.render()
        }
    }

    func color(for state: String?) -> NSColor {
        switch state {
        case "connected": return .systemGreen
        case "waiting", "starting", "running": return .systemOrange
        case "offline": return .systemRed
        default: return .systemGray
        }
    }

    func render() {
        let dot = busy != nil ? NSColor.systemYellow : color(for: status?.state)
        let title = NSMutableAttributedString(string: "● ", attributes: [.foregroundColor: dot, .font: NSFont.systemFont(ofSize: 12)])
        title.append(NSAttributedString(string: "LG", attributes: [.font: NSFont.menuBarFont(ofSize: 0)]))
        item.button?.attributedTitle = title
        item.button?.toolTip = busy ?? status?.label ?? "Luma · LG"

        let menu = NSMenu()
        let headline = NSMenuItem(title: busy ?? status?.label ?? "Comprobando…", action: nil, keyEquivalent: "")
        headline.isEnabled = false
        menu.addItem(headline)
        if let s = status {
            let tv = NSMenuItem(title: "TV \(s.tvIp): \(s.tvReachable ? "en la red" : "sin respuesta")", action: nil, keyEquivalent: "")
            tv.isEnabled = false; menu.addItem(tv)
            let server = NSMenuItem(title: "Servidor del inicio: \(s.server ? "activo" : "apagado")", action: nil, keyEquivalent: "")
            server.isEnabled = false; menu.addItem(server)
        }
        menu.addItem(.separator())
        let on = status?.lab == true
        let toggle = NSMenuItem(title: on ? "Apagar conexión" : "Encender conexión", action: #selector(toggleConnection), keyEquivalent: "")
        toggle.target = self; toggle.isEnabled = busy == nil; menu.addItem(toggle)
        if on {
            let restart = NSMenuItem(title: "Reiniciar conexión", action: #selector(restartConnection), keyEquivalent: "")
            restart.target = self; restart.isEnabled = busy == nil; menu.addItem(restart)
        }
        menu.addItem(.separator())
        let log = NSMenuItem(title: "Ver registro", action: #selector(openLog), keyEquivalent: "")
        log.target = self; menu.addItem(log)
        let quit = NSMenuItem(title: "Salir del menú", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        item.menu = menu
    }

    @objc func toggleConnection() {
        if status?.lab == true { perform("stop", message: "Apagando…") } else { perform("start", message: "Encendiendo…") }
    }
    @objc func restartConnection() { perform("restart", message: "Reiniciando…") }
    @objc func openLog() { NSWorkspace.shared.open(URL(fileURLWithPath: config.root + "/.local/logs/lab.log")) }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
