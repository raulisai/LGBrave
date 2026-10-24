import Cocoa

// Menu-bar status and one-click control for the Mac side of Holy (and, in a submenu, Luma).
// All logic lives in scripts/holy-control.mjs and scripts/luma-control.mjs; this only draws it.
// The dot is Holy's traffic light: green all well, orange something to look at, red Holy off
// on the Mac or no TV, yellow while an action runs.
struct Config: Decodable { let holyRoot: String; let lumaRoot: String?; let node: String }
struct Check: Decodable { let label: String; let detail: String; let level: String; let fixable: Bool? }
struct HolyStatus: Decodable {
    let state: String; let label: String; let level: String; let mac: Bool
    let macIp: String?; let tvIp: String?; let tvReachable: Bool?; let checks: [Check]?; let done: [String]?
}
struct LumaStatus: Decodable { let state: String; let label: String; let lab: Bool }

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var config: Config!
    var holy: HolyStatus?
    var luma: LumaStatus?
    var busy: String?
    var lastDoctor: [String] = []
    var lastDoctorAt: Date?
    var timer: Timer?
    var polls = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let url = Bundle.main.url(forResource: "config", withExtension: "json"),
              let data = try? Data(contentsOf: url), let cfg = try? JSONDecoder().decode(Config.self, from: data) else {
            item.button?.title = "LG ⚠︎"; return
        }
        config = cfg
        render()
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in self?.poll() }
    }

    // Runs one control script and decodes its last JSON line.
    func run<T: Decodable>(_ root: String, _ script: String, _ action: String, as type: T.Type, completion: @escaping (T?) -> Void) {
        DispatchQueue.global().async {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: self.config.node)
            process.arguments = [root + "/scripts/" + script, action]
            process.currentDirectoryURL = URL(fileURLWithPath: root)
            let pipe = Pipe(); process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
            var result: T?
            do {
                try process.run()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                if let line = String(data: data, encoding: .utf8)?.split(separator: "\n").last {
                    result = try? JSONDecoder().decode(T.self, from: Data(line.utf8))
                }
            } catch { result = nil }
            DispatchQueue.main.async { completion(result) }
        }
    }

    func poll() {
        guard busy == nil else { return }
        run(config.holyRoot, "holy-control.mjs", "status", as: HolyStatus.self) { [weak self] status in self?.holy = status; self?.render() }
        // Luma changes less often: every third time.
        polls += 1
        if let lumaRoot = config.lumaRoot, polls % 3 == 1 {
            run(lumaRoot, "luma-control.mjs", "status", as: LumaStatus.self) { [weak self] status in self?.luma = status; self?.render() }
        }
    }

    func holyAction(_ action: String, message: String) {
        busy = message; render()
        run(config.holyRoot, "holy-control.mjs", action, as: HolyStatus.self) { [weak self] status in
            guard let self = self else { return }
            self.busy = nil
            if let status = status {
                self.holy = status
                if let done = status.done { self.lastDoctor = done; self.lastDoctorAt = Date() }
            } else if action == "doctor" { self.lastDoctor = ["El Doctor no pudo terminar"]; self.lastDoctorAt = Date() }
            self.render()
        }
    }

    func lumaAction(_ action: String, message: String) {
        guard let lumaRoot = config.lumaRoot else { return }
        busy = message; render()
        run(lumaRoot, "luma-control.mjs", action, as: LumaStatus.self) { [weak self] status in
            self?.busy = nil
            if let status = status { self?.luma = status }
            self?.render()
        }
    }

    func color(for level: String?) -> NSColor {
        switch level {
        case "green": return .systemGreen
        case "orange": return .systemOrange
        case "red": return .systemRed
        default: return .systemGray
        }
    }

    func info(_ title: String, _ menu: NSMenu, indent: Int = 0) {
        let line = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        line.isEnabled = false; line.indentationLevel = indent
        menu.addItem(line)
    }

    func action(_ title: String, _ selector: Selector, _ menu: NSMenu, enabled: Bool = true) {
        let entry = NSMenuItem(title: title, action: selector, keyEquivalent: "")
        entry.target = self; entry.isEnabled = enabled && busy == nil
        menu.addItem(entry)
    }

    func render() {
        let dot = busy != nil ? NSColor.systemYellow : color(for: holy?.level)
        let title = NSMutableAttributedString(string: "● ", attributes: [.foregroundColor: dot, .font: NSFont.systemFont(ofSize: 12)])
        title.append(NSAttributedString(string: "LG", attributes: [.font: NSFont.menuBarFont(ofSize: 0)]))
        item.button?.attributedTitle = title
        item.button?.toolTip = busy ?? holy?.label ?? "Holy · LG"

        let menu = NSMenu()
        info(busy ?? holy?.label ?? "Comprobando Holy…", menu)
        if let s = holy {
            if let tvIp = s.tvIp, !tvIp.isEmpty { info("TV \(tvIp): \(s.tvReachable == true ? "en la red" : "sin respuesta")", menu) }
            if let macIp = s.macIp { info("Mac \(macIp): \(s.mac ? "Holy activo" : "Holy apagado")", menu) }
            for check in s.checks ?? [] { info("\(check.level == "warn" ? "⚠︎" : "·") \(check.label): \(check.detail)", menu) }
        }
        if !lastDoctor.isEmpty, let at = lastDoctorAt, Date().timeIntervalSince(at) < 600 {
            menu.addItem(.separator())
            info("Doctor:", menu)
            for line in lastDoctor { info(line, menu, indent: 1) }
        }
        menu.addItem(.separator())
        action("Doctor: revisar y arreglar", #selector(runDoctor), menu)
        if holy?.mac == true {
            action("Reiniciar Holy en el Mac", #selector(restartHoly), menu)
            action("Apagar Holy en el Mac", #selector(stopHoly), menu)
        } else {
            action("Encender Holy en el Mac", #selector(startHoly), menu)
        }
        action("Abrir Holy en la TV", #selector(openOnTV), menu, enabled: holy?.tvReachable == true && holy?.state != "connected")
        action("Ver registro de Holy", #selector(openHolyLog), menu)

        if config?.lumaRoot != nil {
            menu.addItem(.separator())
            let sub = NSMenu()
            info(luma?.label ?? "Comprobando…", sub)
            let on = luma?.lab == true
            let toggle = NSMenuItem(title: on ? "Apagar conexión de Luma" : "Encender conexión de Luma", action: #selector(toggleLuma), keyEquivalent: "")
            toggle.target = self; toggle.isEnabled = busy == nil; sub.addItem(toggle)
            if on {
                let restart = NSMenuItem(title: "Reiniciar conexión de Luma", action: #selector(restartLuma), keyEquivalent: "")
                restart.target = self; restart.isEnabled = busy == nil; sub.addItem(restart)
            }
            let log = NSMenuItem(title: "Ver registro de Luma", action: #selector(openLumaLog), keyEquivalent: "")
            log.target = self; sub.addItem(log)
            let entry = NSMenuItem(title: "Luma (navegador)", action: nil, keyEquivalent: "")
            entry.submenu = sub
            menu.addItem(entry)
        }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Salir del menú", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        item.menu = menu
    }

    @objc func runDoctor() { holyAction("doctor", message: "Doctor revisando…") }
    @objc func restartHoly() { holyAction("restart", message: "Reiniciando Holy…") }
    @objc func stopHoly() { holyAction("stop", message: "Apagando Holy…") }
    @objc func startHoly() { holyAction("start", message: "Encendiendo Holy…") }
    @objc func openOnTV() { holyAction("open", message: "Abriendo Holy en la TV…") }
    @objc func openHolyLog() {
        let file = config.holyRoot + "/.local/logs/holy.log"
        if !FileManager.default.fileExists(atPath: file) { FileManager.default.createFile(atPath: file, contents: Data("Holy aún no se encendió desde el menú.\n".utf8)) }
        NSWorkspace.shared.open(URL(fileURLWithPath: file))
    }
    @objc func toggleLuma() {
        if luma?.lab == true { lumaAction("stop", message: "Apagando Luma…") } else { lumaAction("start", message: "Encendiendo Luma…") }
    }
    @objc func restartLuma() { lumaAction("restart", message: "Reiniciando Luma…") }
    @objc func openLumaLog() { if let root = config.lumaRoot { NSWorkspace.shared.open(URL(fileURLWithPath: root + "/.local/logs/lab.log")) } }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
