Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
WScript.Sleep 1500
shell.Run "http://127.0.0.1:17654/", 1, False
