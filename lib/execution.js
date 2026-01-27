import { spawn } from "child_process";

export async function executeCommand(command, cwd) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";

    const proc = spawn("bash", ["-c", command], {
      cwd: cwd || process.cwd(),
      env: process.env,
    });

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr,
        duration: ((Date.now() - startTime) / 1000).toFixed(2),
      });
    });

    proc.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: error.message,
        duration: ((Date.now() - startTime) / 1000).toFixed(2),
      });
    });
  });
}
