#define MyAppName "Johns Print Agent - Samouha"
#define MyAppVersion "2.1.1"
#define MyAppExeName "JohnsPrintAgent-Samouha.exe"

[Setup]
AppId={{A28A4B12-784B-4E89-A917-E2F2E66E41C3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Premieros
DefaultDirName={localappdata}\Programs\JohnsPrintAgentSamouha
DefaultGroupName=Johns Print Agent - Samouha
PrivilegesRequired=lowest
OutputDir=..\..\build-samouha
OutputBaseFilename=JohnsPrintAgent-Samouha-Setup-2.1.1
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Johns Print Agent - Samouha
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "..\..\build-samouha\JohnsPrintAgent-Samouha.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "run-hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\إعداد طابعات فرع سموحة"; Filename: "{cmd}"; Parameters: "/c start "" http://127.0.0.1:17654/"; WorkingDir: "{app}"
Name: "{userstartup}\Johns Print Agent - Samouha"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\run-hidden.vbs"""; WorkingDir: "{app}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\run-hidden.vbs"""; Description: "تشغيل خدمة طباعة فرع سموحة"; Flags: nowait postinstall skipifsilent
Filename: "{cmd}"; Parameters: "/c timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:17654/"; Description: "فتح إعداد طابعات سموحة"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /IM JohnsPrintAgent-Samouha.exe /F >nul 2>nul"; Flags: runhidden; RunOnceId: "StopSamouhaAgent"
