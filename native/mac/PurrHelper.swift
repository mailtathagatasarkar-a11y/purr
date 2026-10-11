// Purr native helper for macOS. Build: node scripts/build-helpers.mjs (needs Xcode CLT).
//
// Adds what Node can't do:
//  - the fn / Globe key (uiohook can't see it) and every other key via a CGEventTap,
//    which can also SWALLOW the last key of a Purr shortcut (so Option+S doesn't type "ß");
//  - the frontmost app, its window title, and the focused text field (Accessibility API).
//
// Same protocol as the Windows helper. stdin: "cmd\tid\targ"; stdout: JSON lines.
//   chords 0 Fn|Fn+Space|Fn+Ctrl|Alt+S     esc 0 1|0     pause 0 1|0
//   frontmost <id>   focused <id>   trusted <id>   quit

import Cocoa
import ApplicationServices

setvbuf(stdout, nil, _IOLBF, 0)

let outQueue = DispatchQueue(label: "purr.out")
func emit(_ obj: [String: Any]) {
    outQueue.async {
        if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
            print(s)
        }
    }
}

// Key names match uiohook-napi's.
let names: [Int64: String] = [
    0: "A", 11: "B", 8: "C", 2: "D", 14: "E", 3: "F", 5: "G", 4: "H", 34: "I", 38: "J", 40: "K", 37: "L", 46: "M",
    45: "N", 31: "O", 35: "P", 12: "Q", 15: "R", 1: "S", 17: "T", 32: "U", 9: "V", 13: "W", 7: "X", 16: "Y", 6: "Z",
    29: "0", 18: "1", 19: "2", 20: "3", 21: "4", 23: "5", 22: "6", 26: "7", 28: "8", 25: "9",
    49: "Space", 53: "Escape", 36: "Enter", 48: "Tab", 51: "Backspace", 117: "Delete", 57: "CapsLock",
    123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp", 115: "Home", 119: "End", 116: "PageUp", 121: "PageDown",
    41: "Semicolon", 24: "Equal", 43: "Comma", 27: "Minus", 47: "Period", 44: "Slash", 50: "Backquote",
    33: "BracketLeft", 42: "Backslash", 30: "BracketRight", 39: "Quote",
    122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
    105: "F13", 107: "F14", 113: "F15", 106: "F16", 64: "F17", 79: "F18", 80: "F19", 90: "F20",
    59: "CtrlLeft", 62: "CtrlRight", 58: "AltLeft", 61: "AltRight", 56: "ShiftLeft", 60: "ShiftRight", 55: "MetaLeft", 54: "MetaRight",
    63: "Fn", 179: "Fn"
]

let modifierFlags: [String: CGEventFlags] = [
    "CtrlLeft": .maskControl, "CtrlRight": .maskControl, "AltLeft": .maskAlternate, "AltRight": .maskAlternate,
    "ShiftLeft": .maskShift, "ShiftRight": .maskShift, "MetaLeft": .maskCommand, "MetaRight": .maskCommand, "Fn": .maskSecondaryFn
]

var chords: [[String]] = []
var pressed = Set<String>()
var swallowed = Set<String>()
var swallowEsc = false
var paused = false
var tap: CFMachPort?

func satisfies(_ binding: String, _ key: String) -> Bool {
    if binding == key { return true }
    let generic = key.replacingOccurrences(of: "Left", with: "").replacingOccurrences(of: "Right", with: "")
    return (key.hasSuffix("Left") || key.hasSuffix("Right")) && generic == binding
}

func exact(_ chord: [String], _ keys: Set<String>) -> Bool {
    if chord.count != keys.count { return false }
    var pool = Array(keys)
    for b in chord {
        guard let i = pool.firstIndex(where: { satisfies(b, $0) }) else { return false }
        pool.remove(at: i)
    }
    return true
}

func isModifier(_ k: String) -> Bool { modifierFlags[k] != nil }

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let t = tap { CGEvent.tapEnable(tap: t, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    guard let name = names[code] else { return Unmanaged.passUnretained(event) }

    if type == .flagsChanged {
        guard let flag = modifierFlags[name] else { return Unmanaged.passUnretained(event) }
        // For left/right pairs the flag alone can't tell which side changed; the keycode can.
        let down: Bool
        if name == "Fn" { down = event.flags.contains(.maskSecondaryFn) } else { down = !pressed.contains(name) && event.flags.contains(flag) }
        if down && !pressed.contains(name) {
            pressed.insert(name)
            emit(["e": "kd", "k": name])
        } else if !down && pressed.contains(name) {
            pressed.remove(name)
            emit(["e": "ku", "k": name])
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .keyDown {
        let repeatKey = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
        if !repeatKey && !pressed.contains(name) {
            pressed.insert(name)
            emit(["e": "kd", "k": name])
        }
        if swallowed.contains(name) { return nil }
        if !paused {
            if name == "Escape" && swallowEsc { swallowed.insert(name); return nil }
            for c in chords where exact(c, pressed) {
                if !isModifier(name) { swallowed.insert(name); return nil }
                break
            }
        }
    } else if type == .keyUp {
        if pressed.contains(name) {
            pressed.remove(name)
            emit(["e": "ku", "k": name])
        }
        if swallowed.remove(name) != nil { return nil }
    }
    return Unmanaged.passUnretained(event)
}

func startTap() -> Bool {
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
    guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                    eventsOfInterest: CGEventMask(mask), callback: callback, userInfo: nil) else { return false }
    tap = t
    let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
    CGEvent.tapEnable(tap: t, enable: true)
    return true
}

func axString(_ el: AXUIElement, _ attr: String) -> String? {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &v) == .success else { return nil }
    return v as? String
}

func frontmost(_ id: String) {
    DispatchQueue.main.async {
        let app = NSWorkspace.shared.frontmostApplication
        var title = ""
        if let pid = app?.processIdentifier {
            let ax = AXUIElementCreateApplication(pid)
            var win: CFTypeRef?
            if AXUIElementCopyAttributeValue(ax, kAXFocusedWindowAttribute as CFString, &win) == .success, let w = win {
                title = axString(w as! AXUIElement, kAXTitleAttribute) ?? ""
            }
        }
        emit(["id": id, "bundleId": app?.bundleIdentifier ?? "", "name": app?.localizedName ?? "", "title": title])
    }
}

func focused(_ id: String) {
    DispatchQueue.global().async {
        let system = AXUIElementCreateSystemWide()
        var el: CFTypeRef?
        var value = "", selection = "", role = ""
        if AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &el) == .success, let e = el {
            let ax = e as! AXUIElement
            role = axString(ax, kAXRoleAttribute) ?? ""
            let subrole = axString(ax, kAXSubroleAttribute) ?? ""
            if subrole != (kAXSecureTextFieldSubrole as String) {
                value = String((axString(ax, kAXValueAttribute) ?? "").prefix(8000))
                selection = String((axString(ax, kAXSelectedTextAttribute) ?? "").prefix(4000))
            }
        }
        emit(["id": id, "value": value, "selection": selection, "control": role])
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let trusted = AXIsProcessTrusted()
let tapOk = trusted && startTap()
emit(["e": "hook", "ok": tapOk])

Thread {
    while let line = readLine() {
        let parts = line.components(separatedBy: "\t")
        let cmd = parts[0]
        let id = parts.count > 1 ? parts[1] : "0"
        let arg = parts.count > 2 ? parts[2] : ""
        switch cmd {
        case "chords":
            let list = arg.split(separator: "|").map { $0.split(separator: "+").map(String.init) }
            DispatchQueue.main.async { chords = list }
        case "esc": DispatchQueue.main.async { swallowEsc = arg == "1" }
        case "pause": DispatchQueue.main.async { paused = arg == "1" }
        case "frontmost": frontmost(id)
        case "focused": focused(id)
        case "trusted":
            let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: arg == "prompt"] as CFDictionary
            emit(["id": id, "ok": AXIsProcessTrustedWithOptions(opts)])
        case "quit": exit(0)
        default: break
        }
    }
    exit(0) // Purr quit
}.start()

// Accessibility can be granted while we run: retry the tap until it works.
if !tapOk {
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { timer in
        if AXIsProcessTrusted() && startTap() {
            emit(["e": "hook", "ok": true])
            timer.invalidate()
        }
    }
}

app.run()
