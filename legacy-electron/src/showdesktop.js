'use strict';
const log = require('./logger');

const POLL_MS = 80;
const EXIT_TICKS = 2; // lecturas seguidas sin escritorio encima antes de bajar las cercas

/**
 * Cuando Windows "muestra el escritorio" (Win+D o el botón del extremo de la barra de tareas), la
 * ventana del escritorio se coloca por encima de las ventanas normales y tapa las cercas. Solo las
 * ventanas "siempre encima" se salvan, así que las subimos mientras dura y después las devolvemos
 * a su sitio (detrás de las demás ventanas, sobre el escritorio).
 *
 * `native` ofrece: createAnchor, destroyAnchor, desktopCovers, hwndOf, setTopmost, lower, describe.
 * `targets()` devuelve [{ id, win, pinned }] de las cercas vivas.
 */
function createGuard({ native, targets, isHidden, keepOnTop, timer, now = Date.now }) {
  const clock = timer || { set: setInterval, clear: clearInterval };
  const raised = new Map(); // id -> momento en que la subimos
  let anchor = 0;
  let handle = null;
  let shown = false;
  let offTicks = 0;
  let failures = 0;

  const staysOnTop = (t) => !!(t.pinned || keepOnTop());
  const describe = () => { try { return native.describe(); } catch { return {}; } };

  function raise(t) {
    native.setTopmost(native.hwndOf(t.win));
    raised.set(t.id, now());
  }

  function ensureRaised() {
    if (isHidden()) return;
    for (const t of targets()) {
      if (t.win.isDestroyed() || t.win.isAlwaysOnTop()) continue;
      const at = raised.get(t.id);
      if (at !== undefined && now() - at < 800) continue; // no insistir en cada lectura
      raise(t);
    }
  }

  function lowerAll() {
    for (const t of targets()) {
      if (!raised.has(t.id) || t.win.isDestroyed() || staysOnTop(t)) continue;
      native.lower(native.hwndOf(t.win));
    }
    raised.clear();
  }

  function tick() {
    try {
      const covers = native.desktopCovers(anchor);
      failures = 0;
      if (covers) {
        offTicks = 0;
        if (!shown) {
          shown = true;
          log.info('Mostrar escritorio detectado: las cercas pasan al frente.', describe());
        }
        ensureRaised();
      } else if (shown && ++offTicks >= EXIT_TICKS) {
        shown = false;
        offTicks = 0;
        lowerAll();
        log.info('El escritorio volvió a su sitio: las cercas quedan detrás de las ventanas.', describe());
      }
    } catch (e) {
      if (++failures >= 5) {
        log.error('Se desactiva la detección de "Mostrar escritorio":', e);
        stop();
      }
    }
  }

  function start() {
    if (handle) return true;
    try {
      anchor = native.createAnchor();
    } catch (e) {
      log.warn('No se pudo crear la ventana de referencia:', e && e.message);
      anchor = 0;
    }
    if (!anchor) {
      log.warn('La detección de "Mostrar escritorio" no está disponible en este equipo.');
      return false;
    }
    handle = clock.set(tick, POLL_MS);
    if (handle && typeof handle.unref === 'function') handle.unref();
    log.info('Detección de "Mostrar escritorio" activa.', describe());
    return true;
  }

  function stop() {
    if (handle) { clock.clear(handle); handle = null; }
    try { if (shown) lowerAll(); } catch { /* ya no hay ventanas */ }
    shown = false;
    try { if (anchor) native.destroyAnchor(anchor); } catch { /* ya liberada */ }
    anchor = 0;
  }

  return { start, stop, tick, isActive: () => shown, isRunning: () => !!handle };
}

module.exports = { createGuard, POLL_MS, EXIT_TICKS };
