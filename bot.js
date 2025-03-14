import fs from "fs/promises";
import log from "./utils/logger.js";
import { readFile, delay, readJson } from "./utils/helper.js";
import banner from "./utils/banner.js";
import LayerEdge from "./utils/socket.js";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { fileURLToPath } from "url"; // Import necessary functions for file URL conversion
import { dirname } from "path"; // Import necessary functions for path manipulation
import { config } from "./config.js";

const __filename = fileURLToPath(import.meta.url); // Get the current module's filename
const __dirname = dirname(__filename);

// Function to read wallets
async function readWallets() {
  try {
    await fs.access("wallets.json");

    const data = await fs.readFile("wallets.json", "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      log.info("No wallets found in wallets.json");
      return [];
    }
    throw err;
  }
}

class Client {
  constructor(wallet, accountIndex, proxy, localStorage, tasks) {
    this.wallet = wallet;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIp = "Unknown IP";
    this.localStorage = localStorage;
    this.tasks = tasks;
  }

  async runAccount() {
    const i = this.accountIndex + 1;
    const wallet = this.wallet;
    const proxy = this.proxy || null;
    const { address, privateKey } = wallet;
    try {
      const socket = new LayerEdge(proxy, privateKey, config.ref_code, this.localStorage, this.tasks);
      log.info(`[Account ${i}] Processing Wallet Address: ${address} with proxy:`, proxy);
      log.info(`[Account ${i}] Checking Node Status for: ${address}`);
      const isRunning = await socket.checkNodeStatus();

      if (isRunning) {
        log.info(`[Account ${i}] Wallet ${address} is running - trying to claim node points...`);
        await socket.stopNode();
      }
      log.info(`[Account ${i}] Trying to reconnect node for Wallet: ${address}`);
      await socket.connectNode();

      log.info(`[Account ${i}] Checking Node Points for Wallet: ${address}`);
      await socket.checkNodePoints();

      log.info(`[Account ${i}] Checking Tasks for Wallet: ${address}`);
      const resTask = await socket.handleTasks();
      if (resTask) {
        parentPort.postMessage({ message: "saveTask", value: resTask, address: this.wallet.address });
      }
    } catch (error) {
      log.error(`[Account ${i}] Error Processing wallet:`, error.message);
    }
  }
}

async function runWorker(workerData) {
  const { wallet, accountIndex, proxy, localStorage, tasks } = workerData;
  const to = new Client(wallet, accountIndex, proxy, localStorage, tasks);
  try {
    await to.runAccount();
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  log.warn(banner);
  await delay(3);

  const proxies = await readFile("proxy.txt");
  let wallets = await readWallets();
  let localStorage = await readJson("localStorage.json");
  const tasksCompleted = localStorage;
  const tasks = await readJson("tasks.json", []);
  if (proxies.length === 0) log.warn("No proxies found in proxy.txt - running without proxies");
  if (wallets.length === 0) {
    log.info('No Wallets found, creating new Wallets first "npm run autoref"');
    return;
  }

  log.info("Starting run Program with all Wallets:", wallets.length);
  let maxThreads = config.max_threads;

  while (true) {
    let currentIndex = 0;
    const errors = [];

    while (currentIndex < wallets.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, wallets.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            wallet: wallets[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
            localStorage,
            tasks,
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (message?.message === "saveTask") {
                // if(wallets[currentIndex].address && tasksCompleted.find(t => t.address ===wallets[currentIndex].address))
                const address = message.address;
                tasksCompleted[address] = {
                  ...tasksCompleted[address],
                  tasks: [...(tasksCompleted[address]?.tasks || []), message.value],
                };
              }
              // if (settings.ENABLE_DEBUG) {
              //   console.log(message);
              // }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < wallets.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    await fs.writeFile("localStorage.json", JSON.stringify(tasksCompleted, null, 4));

    log.debug(`[${new Date().toISOString()}] Completed all accounts wait 20 hours...`);
    await delay(20 * 60 * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
