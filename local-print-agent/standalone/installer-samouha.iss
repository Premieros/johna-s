#define MyAppName "Johns Print Agent - Samouha"
#define MyAppVersion "2.1.2"
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
OutputBaseFilename=JohnsPrintAgent-Samouha-Setup-2.1.2
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
Source: "run-hidden-samouha.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "open-settings-samouha.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\إعداد طابعات فرع سموحة"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\open-settings-samouha.vbs"""; WorkingDir: "{app}"
Name: "{userdesktop}\إعداد طابعات فرع سموحة"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\open-settings-samouha.vbs"""; WorkingDir: "{app}"
Name: "{userstartup}\Johns Print Agent - Samouha"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\run-hidden-samouha.vbs"""; WorkingDir: "{app}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\run-hidden-samouha.vbs"""; Description: "تشغيل خدمة طباعة فرع سموحة"; Flags: nowait postinstall skipifsilent
Filename: "{sys}\wscript.exe"; Parameters: """{app}\open-settings-samouha.vbs"""; Description: "فتح إعداد طابعات سموحة"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/c taskkill /IM JohnsPrintAgent-Samouha.exe /F >nul 2>nul"; Flags: runhidden; RunOnceId: "StopSamouhaAgent"
