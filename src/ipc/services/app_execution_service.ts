import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import { getDyadAppPath } from "../../paths/paths";
import { promises as fsPromises } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import killPort from "kill-port";
import util from "util";
import log from "electron-log";
import {
  runningApps,
  processCounter,
  killProcess,
  removeAppIfCurrentProcess,
} from "../utils/process_manager";
import { withLock } from "../utils/lock_utils";
import fixPath from "fix-path";

const logger = log.scope("app_execution_service");

// Needed, otherwise electron in MacOS/Linux will not be able
// to find node/pnpm.
fixPath();

// Helper to kill process on a specific port (cross-platform, using kill-port)
async function killProcessOnPort(port: number): Promise<void> {
  try {
    await killPort(port, "tcp");
    logger.log(`Successfully killed process on port ${port}`);
  } catch (err) {
    // Ignore if nothing was running on that port
    logger.debug(`No process found on port ${port} or failed to kill: ${err}`);
  }
}

/**
 * Executes the app using local Node.js and pnpm/npm.
 */
async function executeAppLocalNode({
  appPath,
  appId,
  event,
}: {
  appPath: string;
  appId: number;
  event: Electron.IpcMainInvokeEvent;
}): Promise<void> {
  // Use pnpm first, then fallback to npm
  const command = "(pnpm install && pnpm run dev --port 32100) || (npm install && npm run dev -- --port 32100)";
  logger.log(`Executing app ${appId} with command: ${command} in ${appPath}`);

  const process = spawn(command, [], {
    cwd: appPath,
    shell: true,
    stdio: "pipe", // Ensure stdio is piped so we can capture output/errors and detect close
    detached: false, // Ensure child process is attached to the main process lifecycle unless explicitly backgrounded
  });

  // Check if process spawned correctly
  if (!process.pid) {
    // Attempt to capture any immediate errors if possible
    let errorOutput = "";
    process.stderr?.on("data", (data) => (errorOutput += data));
    await new Promise((resolve) => process.on("error", resolve)); // Wait for error event
    throw new Error(
      `Failed to spawn process for app ${appId}. Error: ${
        errorOutput || "Unknown spawn error"
      }`
    );
  }

  // Increment the counter and store the process reference with its ID
  const currentProcessId = processCounter.increment();
  runningApps.set(appId, { process, processId: currentProcessId });
  logger.log(`App ${appId} started with PID: ${process.pid}, processId: ${currentProcessId}`);


  // Log output
  process.stdout?.on("data", (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.debug(`App ${appId} (PID: ${process.pid}) stdout: ${message}`);
    event.sender.send("app:output", {
      type: "stdout",
      message,
      appId,
      timestamp: Date.now(),
    });
  });

  process.stderr?.on("data", (data) => {
    const message = util.stripVTControlCharacters(data.toString());
    logger.error(`App ${appId} (PID: ${process.pid}) stderr: ${message}`);
    event.sender.send("app:output", {
      type: "stderr",
      message,
      appId,
      timestamp: Date.now(),
    });
  });

  // Handle process exit/close
  process.on("close", (code, signal) => {
    logger.log(
      `App ${appId} (PID: ${process.pid}) process closed with code ${code}, signal ${signal}.`
    );
    removeAppIfCurrentProcess(appId, process);
    event.sender.send("app:output", {
      type: "info",
      message: `App process closed with code ${code}, signal ${signal}.`,
      appId,
      timestamp: Date.now(),
    });
  });

  // Handle errors during process lifecycle (e.g., command not found)
  process.on("error", (err) => {
    logger.error(
      `Error in app ${appId} (PID: ${process.pid}) process: ${err.message}`
    );
    removeAppIfCurrentProcess(appId, process);
    event.sender.send("app:output", {
      type: "client-error", // Use client-error type for process errors
      message: `App process error: ${err.message}`,
      appId,
      timestamp: Date.now(),
    });
  });
}

/**
 * Runs a specific app.
 */
export async function runAppService(
  appId: number,
  event: Electron.IpcMainInvokeEvent, // Pass event to send output
  onOutput: (output: any) => void // Callback to send output to renderer
): Promise<{ success: boolean; message?: string }> {
  return withLock(appId, async () => {
    // Check if app is already running
    if (runningApps.has(appId)) {
      logger.debug(`App ${appId} is already running.`);
      // Re-attach output listener if needed (though current IPC client design handles this)
      // Send a message indicating it's already running
      event.sender.send("app:output", {
        type: "info",
        message: "App is already running.",
        appId,
        timestamp: Date.now(),
      });
      return { success: true, message: "App already running." };
    }

    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    logger.debug(`Starting app ${appId} in path ${app.path}`);

    const appPath = getDyadAppPath(app.path);
    try {
      // Kill any orphaned process on port 32100 before starting
      await killProcessOnPort(32100);

      await executeAppLocalNode({ appPath, appId, event }); // Use the local node execution

      return { success: true };
    } catch (error: any) {
      logger.error(`Error running app ${appId}:`, error);
      // Ensure cleanup if error happens during setup but before process events are handled
      if (
        runningApps.has(appId) &&
        runningApps.get(appId)?.processId === processCounter.value
      ) {
        runningApps.delete(appId);
      }
      // Send error message to renderer
      event.sender.send("app:output", {
        type: "client-error",
        message: `Failed to run app: ${error.message}`,
        appId,
        timestamp: Date.now(),
      });
      throw new Error(`Failed to run app ${appId}: ${error.message}`);
    }
  });
}

/**
 * Stops a running app.
 */
export async function stopAppService(appId: number): Promise<{ success: boolean; message?: string }> {
  logger.log(
    `Attempting to stop app ${appId}. Current running apps: ${runningApps.size}`
  );
  return withLock(appId, async () => {
    const appInfo = runningApps.get(appId);

    if (!appInfo) {
      logger.log(
        `App ${appId} not found in running apps map. Assuming already stopped.`
      );
      return {
        success: true,
        message: "App not running.",
      };
    }

    const { process, processId } = appInfo;
    logger.log(
      `Found running app ${appId} with processId ${processId} (PID: ${process.pid}). Attempting to stop.`
    );

    // Check if the process is already exited or closed
    if (process.exitCode !== null || process.signalCode !== null) {
      logger.log(
        `Process for app ${appId} (PID: ${process.pid}) already exited (code: ${process.exitCode}, signal: ${process.signalCode}). Cleaning up map.`
      );
      runningApps.delete(appId); // Ensure cleanup if somehow missed
      return { success: true, message: "Process already exited." };
    }

    try {
      // Use the killProcess utility to stop the process
      await killProcess(process);

      // Now, safely remove the app from the map *after* confirming closure
      removeAppIfCurrentProcess(appId, process);
      logger.log(`Successfully stopped app ${appId}.`);

      // Kill any orphaned process on port 32100 after stopping
      await killProcessOnPort(32100);

      return { success: true };
    } catch (error: any) {
      logger.error(
        `Error stopping app ${appId} (PID: ${process.pid}, processId: ${processId}):`,
        error
      );
      // Attempt cleanup even if an error occurred during the stop process
      removeAppIfCurrentProcess(appId, process);
      throw new Error(`Failed to stop app ${appId}: ${error.message}`);
    }
  });
}

/**
 * Restarts a running app, optionally cleaning node_modules.
 */
export async function restartAppService(
  appId: number,
  event: Electron.IpcMainInvokeEvent, // Pass event to send output
  onOutput: (output: any) => void, // Callback to send output to renderer
  removeNodeModules?: boolean
): Promise<{ success: boolean }> {
  logger.log(`Restarting app ${appId}`);
  return withLock(appId, async () => {
    try {
      // First stop the app if it's running
      const appInfo = runningApps.get(appId);
      if (appInfo) {
        const { process, processId } = appInfo;
        logger.log(
          `Stopping app ${appId} (processId ${processId}) before restart`
        );

        await killProcess(process);
        runningApps.delete(appId);
      } else {
        logger.log(`App ${appId} not running. Proceeding to start.`);
      }

      // Kill any orphaned process on port 32100 (in case previous run left it)
      await killProcessOnPort(32100);

      // Now start the app again
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      const appPath = getDyadAppPath(app.path);

      // Remove node_modules if requested
      if (removeNodeModules) {
        const nodeModulesPath = path.join(appPath, "node_modules");
        logger.log(
          `Removing node_modules for app ${appId} at ${nodeModulesPath}`
        );
        if (fs.existsSync(nodeModulesPath)) {
          await fsPromises.rm(nodeModulesPath, {
            recursive: true,
            force: true,
          });
          logger.log(`Successfully removed node_modules for app ${appId}`);
        } else {
          logger.log(`No node_modules directory found for app ${appId}`);
        }
      }

      logger.debug(
        `Executing app ${appId} in path ${app.path} after restart request`
      ); // Adjusted log

      await executeAppLocalNode({ appPath, appId, event }); // Use the local node execution

      return { success: true };
    } catch (error) {
      logger.error(`Error restarting app ${appId}:`, error);
      // Send error message to renderer
      event.sender.send("app:output", {
        type: "client-error",
        message: `Failed to restart app: ${error.message}`,
        appId,
        timestamp: Date.now(),
      });
      throw error;
    }
  });
}