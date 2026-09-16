#define MyAppName "Johns Print Agent"
#define MyAppVersion "2.1.0"
#define MyAppExeName "JohnsPrintAgent.exe"

[Setup]
AppId={{6CEBF178-4A3E-4E26-9C3C-7C3B47FE2D11}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Premieros
DefaultDirName={localappdata}\Programs\JohnsPrintAgent
DefaultGroupName=Johns Print Agent
PrivilegesRequired=lowest
OutputDir=..\..\build
OutputBaseFilename=JohnsPrintAgent-Setup-2.1.0
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Johns Print Agent
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "..\..\build\JohnsPrintAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "run-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\إعداد طابعات Johns"; Filename: "{cmd}"; Parameters: "/c start """" http://127.0.0.1:17654/"; WorkingDir: "{app}"
Name: "{userstartup}\Johns Print Agent"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\run-hidden.vbs"""; WorkingDir: "{app}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\run-hidden.vbs"""; Description: "تشغيل خدمة الطباعة"; Flags: nowait postinstall skipifsilent
Filename: "{cmd}"; Parameters: "/c timeout /t 2 /nobreak >nul & start """" http://127.0.0.1:17654/"; Description: "فتح إعداد الطابعات"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /IM JohnsPrintAgent.exe /F >nul 2>nul"; Flags: runhidden; RunOnceId: "StopAgent"
