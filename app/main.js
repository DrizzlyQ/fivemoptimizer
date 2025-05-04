const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile(path.join(__dirname, '../index.html'));
}

app.whenReady().then(() => {
  createWindow();
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = "info";

  autoUpdater.checkForUpdatesAndNotify();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


// ✅ TEMP FOLDER SIZE
ipcMain.handle('get-temp-size', async () => {
  const tempPath = process.env.TEMP || process.env.TMP;
  let totalSize = 0;

  function getFolderSize(folderPath) {
    const files = fs.readdirSync(folderPath);
    for (let file of files) {
      const fullPath = path.join(folderPath, file);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isFile()) {
          totalSize += stats.size;
        } else if (stats.isDirectory()) {
          getFolderSize(fullPath);
        }
      } catch (e) {}
    }
  }

  getFolderSize(tempPath);
  return (totalSize / (1024 * 1024)).toFixed(1); // MB
});


// ✅ CLEAN TEMP FILES
ipcMain.handle('clean-temp-files', async () => {
  const tempPath = process.env.TEMP || process.env.TMP;
  let deleted = 0;

  function deleteContents(dir) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            deleteContents(filePath);
            fs.rmdirSync(filePath, { recursive: true });
          } else {
            fs.unlinkSync(filePath);
          }
          deleted++;
        } catch {}
      }
    } catch {}
  }

  deleteContents(tempPath);
  return deleted;
});


// ✅ SYSMAIN SERVICE CHECK
ipcMain.handle('check-sysmain', async () => {
  return new Promise((resolve) => {
    exec('sc query "SysMain"', (err, stdout) => {
      if (stdout && stdout.includes('RUNNING')) {
        resolve('running');
      } else {
        resolve('stopped');
      }
    });
  });
});


// ✅ SYSTEM CLEANUP HANDLERS
const cleanupPaths = {
  'prefetch': 'C:\\Windows\\Prefetch',
  'windowsLogs': 'C:\\Windows\\Logs',
  'crashDumps': ['C:\\Windows\\minidump', 'C:\\Windows\\memory.dmp'],
  'softwareDist': 'C:\\Windows\\SoftwareDistribution\\Download'
};

ipcMain.handle('clean-folder', async (event, target) => {
  const paths = Array.isArray(cleanupPaths[target]) ? cleanupPaths[target] : [cleanupPaths[target]];
  let deleted = 0;

  for (const folder of paths) {
    if (!fs.existsSync(folder)) continue;

    const items = fs.readdirSync(folder);
    for (const item of items) {
      const fullPath = path.join(folder, item);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          fs.rmdirSync(fullPath, { recursive: true });
        } else {
          fs.unlinkSync(fullPath);
        }
        deleted++;
      } catch {}
    }

    // Handle memory.dmp (single file case)
    if (folder.endsWith('.dmp') && fs.existsSync(folder)) {
      try {
        fs.unlinkSync(folder);
        deleted++;
      } catch {}
    }
  }

  return deleted;
});


// ✅ SERVICE TWEAKS
const serviceCommands = {
  sysMain: 'sc stop "SysMain"',
  xboxGameMonitoring: 'sc stop "XblGameSave"',
  diagTracking: 'sc config "DiagTrack" start= disabled',
  diagPolicy: 'sc stop "DPS"'
};

ipcMain.handle('toggle-service', async (event, id) => {
  return new Promise((resolve) => {
    const cmd = serviceCommands[id];
    if (!cmd) return resolve(false);

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error with service ${id}:`, error);
        return resolve(false);
      }
      resolve(true);
    });
  });
});
// ✅ GAMING + BACKGROUND OPTIMIZATION HANDLERS
const registryEdits = {
  gameBar: 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 0 /f',
  gpuScheduling: 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f',
  backgroundApps: 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications" /v GlobalUserDisabled /t REG_DWORD /d 1 /f',
  edgeOneDrive: `
    reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v OneDrive /t REG_SZ /d "" /f & 
    reg add "HKLM\\Software\\Policies\\Microsoft\\MicrosoftEdge\\Main" /v PreventFirstRunPage /t REG_DWORD /d 1 /f`
};

ipcMain.handle('run-registry-optimization', async (event, id) => {
  const cmd = registryEdits[id];
  if (!cmd) return false;

  return new Promise((resolve) => {
    exec(cmd, (err) => resolve(!err));
  });
});

// ✅ ENABLE ULTIMATE PERFORMANCE PLAN
ipcMain.handle('enable-performance-plan', async () => {
  return new Promise((resolve) => {
    exec('powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 && powercfg -setactive e9a42b02-d5df-448d-aa00-03f14749eb61', (err) => {
      resolve(!err);
    });
  });
});

// ✅ STOP XBOX SERVICES
ipcMain.handle('stop-xbox-services', async () => {
  return new Promise((resolve) => {
    exec('sc stop "XblAuthManager"', (err) => resolve(!err));
  });
});
// ✅ AUTO-DETECTION HANDLERS
ipcMain.handle('detect-reg-value', async (event, { path, name, expected }) => {
  return new Promise((resolve) => {
    const cmd = `reg query "${path}" /v ${name}`;
    exec(cmd, (err, stdout) => {
      if (err || !stdout.includes(name)) return resolve(false);
      resolve(stdout.includes(expected));
    });
  });
});

ipcMain.handle('detect-power-plan', async () => {
  return new Promise((resolve) => {
    exec('powercfg /getactivescheme', (err, stdout) => {
      if (stdout && stdout.includes('e9a42b02-d5df-448d-aa00-03f14749eb61')) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
});
