import { spawn } from "node:child_process";

export function command(name, args, { input = "", env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(name, args, {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = [];
    process.stdout.on("data", (part) => output.push(part));
    process.stderr.resume();
    process.stdin.on("error", () => {});
    process.stdin.end(input);
    process.on("error", reject);
    process.on("close", (code) => {
      const text = Buffer.concat(output).toString("utf8").trim();
      if (code === 0) resolve(text);
      else
        reject(Object.assign(Error("Αποτυχία εργαλείου: " + name), { code }));
    });
  });
}
const windowsScript = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$mode=$env:OMH_DIALOG_MODE
$text=$env:OMH_DIALOG_MESSAGE
if ($mode -eq 'file') {
  $dialog=New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title='Επιλογή δημόσιου calendar.json'
  $dialog.Filter='Αρχεία JSON (*.json)|*.json'
  if($dialog.ShowDialog() -eq 'OK') { [Console]::WriteLine($dialog.FileName) }
} elseif ($mode -eq 'confirm') {
  if([System.Windows.Forms.MessageBox]::Show($text,'Δημοσίευση ΟΜΗ','YesNo','Question') -eq 'Yes') { [Console]::WriteLine('yes') }
} else {
  [void][System.Windows.Forms.MessageBox]::Show($text,'Δημοσίευση ΟΜΗ')
}
`;
const macScript = `
on run argv
  set mode to item 1 of argv
  set messageText to item 2 of argv
  if mode is "file" then
    return POSIX path of (choose file with prompt "Επιλογή δημόσιου calendar.json")
  else if mode is "confirm" then
    display dialog messageText with title "Δημοσίευση ΟΜΗ" buttons {"Άκυρο", "Συνέχεια"} default button "Άκυρο" cancel button "Άκυρο"
    return "yes"
  else
    display dialog messageText with title "Δημοσίευση ΟΜΗ" buttons {"OK"} default button "OK"
  end if
end run
`;
async function dialog(mode, message = "") {
  const title = "Δημοσίευση ΟΜΗ";
  try {
    if (process.platform === "win32")
      return await command(
        "powershell.exe",
        [
          "-NoProfile",
          "-STA",
          "-EncodedCommand",
          Buffer.from(windowsScript, "utf16le").toString("base64"),
        ],
        {
          env: {
            ...process.env,
            OMH_DIALOG_MODE: mode,
            OMH_DIALOG_MESSAGE: message,
          },
        },
      );
    if (process.platform === "darwin")
      return await command("/usr/bin/osascript", [
        "-e",
        macScript,
        mode,
        message,
      ]);
    if (mode === "file")
      return await command("zenity", [
        "--file-selection",
        "--title=Επιλογή δημόσιου calendar.json",
        "--file-filter=JSON | *.json",
      ]);
    await command("zenity", [
      mode === "confirm" ? "--question" : "--info",
      "--title=" + title,
      "--no-markup",
      "--text=" + message,
    ]);
    return "yes";
  } catch (error) {
    if (error.code === 1 && mode !== "info") return "";
    throw error;
  }
}
export const desktop = {
  choose: () => dialog("file"),
  approve: async (message) => (await dialog("confirm", message)) === "yes",
  message: (message) => dialog("info", message),
};
