# Keyboard helper for the kit.
#
# NVDA only reacts to key presses that arrive through Windows itself, the same
# way a physical keyboard does. This script stays running, takes one command
# per line on standard input, and answers each with one line of JSON:
#
#   focus                 bring the test browser window to the front
#   front                 report which window is in front right now
#   press <combo>         press a key or combination, e.g. tab, shift+tab, nvda+f7, h
#   type <base64 utf-8>   type text into the focused field
#   exit
#
# Safety: "press" and "type" refuse to run unless the test browser is the
# window in front, so keys never land in another application.

param([int]$OwnerPid = 0)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class SrBotWin
{
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);

    public static bool Key(ushort vk, bool extended, bool up)
    {
        INPUT[] input = new INPUT[1];
        input[0].type = 1;
        input[0].U.ki.wVk = vk;
        input[0].U.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        input[0].U.ki.dwFlags = (extended ? 1u : 0u) | (up ? 2u : 0u);
        return SendInput(1, input, Marshal.SizeOf(typeof(INPUT))) == 1;
    }

    public static bool Character(char c)
    {
        INPUT[] input = new INPUT[2];
        input[0].type = 1;
        input[0].U.ki.wScan = c;
        input[0].U.ki.dwFlags = 4;
        input[1].type = 1;
        input[1].U.ki.wScan = c;
        input[1].U.ki.dwFlags = 4 | 2;
        return SendInput(2, input, Marshal.SizeOf(typeof(INPUT))) == 2;
    }

    public static IntPtr Foreground() { return GetForegroundWindow(); }

    public static uint PidOf(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }

    public static string TitleOf(IntPtr h) { StringBuilder sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }

    public static string ClassOf(IntPtr h) { StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }

    public static List<IntPtr> TopWindows()
    {
        List<IntPtr> list = new List<IntPtr>();
        EnumWindows(delegate (IntPtr h, IntPtr l) { if (IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }

    public static bool Front(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9);
        if (GetForegroundWindow() == h) return true;
        uint ignored;
        uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        BringWindowToTop(h);
        SetForegroundWindow(h);
        if (attached) AttachThreadInput(me, fgThread, false);
        Thread.Sleep(150);
        return GetForegroundWindow() == h;
    }
}
'@

$VK = @{
    'tab' = 0x09; 'enter' = 0x0D; 'space' = 0x20; 'escape' = 0x1B; 'esc' = 0x1B; 'backspace' = 0x08
    'up' = 0x26; 'down' = 0x28; 'left' = 0x25; 'right' = 0x27
    'home' = 0x24; 'end' = 0x23; 'pageup' = 0x21; 'pagedown' = 0x22
    'insert' = 0x2D; 'delete' = 0x2E; 'nvda' = 0x2D; 'applications' = 0x5D
    'shift' = 0x10; 'ctrl' = 0x11; 'control' = 0x11; 'alt' = 0x12
    'comma' = 0xBC; 'period' = 0xBE; 'slash' = 0xBF; 'semicolon' = 0xBA; 'minus' = 0xBD; 'equals' = 0xBB
}
foreach ($i in 1..12) { $VK["f$i"] = 0x6F + $i }
foreach ($c in [char[]]'abcdefghijklmnopqrstuvwxyz') { $VK["$c"] = [int][char]::ToUpper($c) }
foreach ($d in 0..9) { $VK["$d"] = 0x30 + $d }
$EXTENDED = @('up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'nvda', 'applications')
$MODIFIERS = @('shift', 'ctrl', 'control', 'alt', 'nvda', 'insert')

$script:browser = $null

function Reply($obj) {
    [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

function Get-FrontInfo {
    $h = [SrBotWin]::Foreground()
    return @{ hwnd = [int64]$h; pid = [int][SrBotWin]::PidOf($h); title = [SrBotWin]::TitleOf($h) }
}

function Find-Browser {
    $parents = @{}
    Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId | ForEach-Object { $parents[[int]$_.ProcessId] = [int]$_.ParentProcessId }
    foreach ($h in [SrBotWin]::TopWindows()) {
        $cls = [SrBotWin]::ClassOf($h)
        if ($cls -ne 'Chrome_WidgetWin_1' -and $cls -ne 'MozillaWindowClass') { continue }
        $title = [SrBotWin]::TitleOf($h)
        if (-not $title) { continue }
        $wpid = [int][SrBotWin]::PidOf($h)
        if ($parents[$wpid] -eq $OwnerPid) { return @{ hwnd = $h; pid = $wpid; title = $title } }
    }
    return $null
}

function Assert-BrowserInFront {
    if ($null -eq $script:browser) { throw 'The test browser has not been located yet. Send "focus" first.' }
    $front = Get-FrontInfo
    if ($front.pid -ne $script:browser.pid) {
        throw "The test browser is not the window in front (in front: '$($front.title)'). No keys were sent."
    }
}

function Send-Combo([string]$combo) {
    $parts = $combo.ToLower().Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    foreach ($p in $parts) { if (-not $VK.ContainsKey($p)) { throw "Unknown key name '$p'." } }
    $mods = @($parts | Where-Object { $MODIFIERS -contains $_ })
    $keys = @($parts | Where-Object { $MODIFIERS -notcontains $_ })
    if ($keys.Count -eq 0 -and $mods.Count -gt 0) { $keys = @($mods[-1]); $mods = @($mods | Select-Object -SkipLast 1) }
    if ($keys.Count -ne 1) { throw "A combination needs exactly one main key: '$combo'." }
    foreach ($m in $mods) { [void][SrBotWin]::Key([uint16]$VK[$m], ($EXTENDED -contains $m), $false); Start-Sleep -Milliseconds 25 }
    $k = $keys[0]
    [void][SrBotWin]::Key([uint16]$VK[$k], ($EXTENDED -contains $k), $false); Start-Sleep -Milliseconds 30
    [void][SrBotWin]::Key([uint16]$VK[$k], ($EXTENDED -contains $k), $true); Start-Sleep -Milliseconds 25
    [array]::Reverse($mods)
    foreach ($m in $mods) { [void][SrBotWin]::Key([uint16]$VK[$m], ($EXTENDED -contains $m), $true); Start-Sleep -Milliseconds 25 }
}

Reply @{ ok = $true; ready = $true }

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if (-not $line) { continue }
    $cmd, $arg = $line.Split(' ', 2)
    try {
        switch ($cmd) {
            'exit' { Reply @{ ok = $true }; exit 0 }
            'front' { $f = Get-FrontInfo; Reply @{ ok = $true; pid = $f.pid; title = $f.title } }
            'focus' {
                $b = Find-Browser
                if ($null -eq $b) { throw 'Could not find the test browser window.' }
                $script:browser = $b
                $ok = [SrBotWin]::Front($b.hwnd)
                Reply @{ ok = [bool]$ok; pid = $b.pid; title = $b.title; error = $(if ($ok) { $null } else { 'Windows would not bring the test browser to the front.' }) }
            }
            'press' {
                Assert-BrowserInFront
                Send-Combo $arg
                Reply @{ ok = $true; pressed = $arg }
            }
            'type' {
                Assert-BrowserInFront
                $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg))
                foreach ($ch in $text.ToCharArray()) { [void][SrBotWin]::Character($ch); Start-Sleep -Milliseconds 20 }
                Reply @{ ok = $true; typed = $text.Length }
            }
            default { throw "Unknown command '$cmd'." }
        }
    }
    catch {
        Reply @{ ok = $false; error = "$($_.Exception.Message)" }
    }
}
