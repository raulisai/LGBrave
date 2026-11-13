import {execFile} from 'node:child_process';
// The service reaches the TV (SSH/CDP leave this computer), but Holy on the TV must also reach
// this computer: catalogue, posters, search and «Conectado a la computadora» are requests from the
// TV to http://<computer>:43190. A firewall can block that direction alone while every outgoing
// check still says «connected». This asks the TV itself, read-only: no screen, no navigation.
const SAFE_HOST = /^[0-9a-z.-]{1,253}$/i;
export function returnPathCommand(host, port) {
  const url = `http://${host}:${Number(port)}/holy-api/health`;
  return `u='${url}'; if command -v curl >/dev/null 2>&1; then c=$(curl -s -m 4 -o /dev/null -w '%{http_code}' "$u" 2>/dev/null); echo "curl \${c:-000}";` +
    ` elif command -v wget >/dev/null 2>&1; then if wget -q -T 4 -O /dev/null "$u" >/dev/null 2>&1; then echo 'wget 200'; else echo 'wget 000'; fi;` +
    ` else echo none; fi; exit 0`;
}
// «curl 200» → reachable; any HTTP code means the network path works. «000» → no answer. Else unknown.
export function readReturnPath(output) {
  const [tool, code = ''] = String(output || '').trim().split(/\s+/);
  if (!['curl', 'wget'].includes(tool) || !/^\d{3}$/.test(code)) return {ok:null, code:''};
  return {ok:code !== '000', code};
}
const PROFILE_NAMES = {Private:'Privada', Public:'Pública', Domain:'de dominio'};
// Windows only, on failure: which network profile Windows applies and whether any enabled inbound
// rule lets this node.exe in on it. No administrator needed (port filters need it: not used).
export function windowsFirewallHint({program = process.execPath, run = powershell} = {}) {
  const script = [
    "$ErrorActionPreference='Stop'",
    `$node='${String(program).replace(/'/g, "''")}'`,
    "$p=Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -First 1",
    "$cat=[string]$p.NetworkCategory; if($cat -eq 'DomainAuthenticated'){$cat='Domain'}",
    "$ids=@(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -ieq $node } | ForEach-Object InstanceID)",
    "$ok=@(Get-NetFirewallRule -Enabled True -Direction Inbound -Action Allow | Where-Object { $ids -contains $_.InstanceID -and (([string]$_.Profile) -eq 'Any' -or ([string]$_.Profile) -match $cat) }).Count",
    "[pscustomobject]@{category=$cat;network=[string]$p.Name;allowed=($ok -gt 0)} | ConvertTo-Json -Compress"
  ].join('; ');
  return run(script).then(text => {
    const found = JSON.parse(text);
    return {category:String(found.category || ''), network:String(found.network || ''), allowed:found.allowed === true};
  }).catch(() => null);
}
function powershell(script) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    {windowsHide:true, timeout:15000, maxBuffer:65536}, (error, stdout) => error ? reject(error) : resolve(String(stdout).trim())));
}
export function describeReturnPath({host, port, firewall}) {
  const base = `La TV no llega a esta computadora (${host}:${port}); Holy en la TV no puede leer catálogo, pósters ni búsqueda.`;
  if (!firewall) return `${base} Revisa el firewall de esta computadora para el puerto ${port} en la red local.`;
  const profile = PROFILE_NAMES[firewall.category] || firewall.category || 'actual';
  const network = firewall.network ? `«${firewall.network}»` : 'esta red';
  if (!firewall.allowed) return `${base} Windows trata ${network} como red ${profile} y su firewall no deja entrar a Holy: ejecuta como administrador windows\\Firewall-LAN.ps1.`;
  return `${base} El firewall de Windows tiene regla para la red ${profile}; revisa el aislamiento de clientes del router, una VPN o el antivirus.`;
}
export function createReturnPathCheck({host, port = 43190, now = Date.now, interval = 5 * 60000, retry = 60000,
  hint = process.platform === 'win32' ? () => windowsFirewallHint() : async () => null, timeout = 8000} = {}) {
  let state = {ok:null, checked:0, code:'', hint:''}, nextAt = 0, running = null, runner = null, hintKey = '';
  return {
    status: () => ({...state}),
    // Called on every loop turn: a new SSH session checks at once, then on its own rhythm.
    due(run) { return !!run && !running && (run !== runner || now() >= nextAt); },
    check(run) {
      if (!this.due(run)) return running || Promise.resolve(this.status());
      runner = run;
      const address = String(typeof host === 'function' ? host() : host || '');
      running = (async () => {
        if (!SAFE_HOST.test(address)) { state = {ok:null, checked:now(), code:'', hint:''}; nextAt = now() + interval; return this.status(); }
        let result = {ok:null, code:''};
        try { result = readReturnPath(await run(returnPathCommand(address, port), timeout)); }
        catch { /* A closed or slow SSH session says nothing about the return path. */ }
        let text = state.hint;
        const key = `${address}|${result.ok}`;
        if (result.ok === false && key !== hintKey) text = describeReturnPath({host:address, port, firewall:await hint().catch(() => null)});
        if (result.ok !== false) text = '';
        hintKey = key;
        state = {ok:result.ok, checked:now(), code:result.code, hint:text};
        nextAt = now() + (result.ok === false ? retry : interval);
        return this.status();
      })().finally(() => { running = null; });
      return running;
    }
  };
}
