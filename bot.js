import fs from "fs/promises";
import log, { banner, readFile, delay, readJson } from "./utils/tools.js";
import LayerEdge from "./utils/socket.js";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function readWallets() {
  try {
    await fs.access("wallets.json");
    const data = await fs.readFile("wallets.json", "utf-8");
    return JSON.parse(data);
  } catch (err) {
    if (err.code === "ENOENT") {
      log.info("wallets.json 中未找到钱包");
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
      log.info(`[账户 ${i}] 处理钱包地址: ${address}，使用代理:`, proxy);
      log.info(`[账户 ${i}] 检查节点状态: ${address}`);
      const isRunning = await socket.checkNodeStatus();

      if (isRunning) {
        log.info(`[账户 ${i}] 钱包 ${address} 正在运行 - 尝试领取节点积分...`);
        await socket.stopNode();
      }
      log.info(`[账户 ${i}] 尝试为钱包重新连接节点: ${address}`);
      await socket.connectNode();

      log.info(`[账户 ${i}] 检查钱包节点积分: ${address}`);
      await socket.checkNodePoints();

      log.info(`[账户 ${i}] 检查钱包任务: ${address}`);
      const resTask = await socket.handleTasks();
      if (resTask) {
        parentPort.postMessage({ message: "saveTask", value: resTask, address: this.wallet.address });
      }
    } catch (error) {
      log.error(`[账户 ${i}] 处理钱包出错:`, error.message);
    }
  }
}

async function runWorker(workerData) {
  const { wallet, accountIndex, proxy, localStorage, tasks } = workerData;
  const to = new Client(wallet, accountIndex, proxy, localStorage, tasks);
  try {
    await to.runAccount();
    parentPort.postMessage({ accountIndex });
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
  const tasks = await readJson("tasks.json", []);
  if (proxies.length === 0) log.warn("proxy.txt 中未找到代理 - 不使用代理运行");
  if (wallets.length === 0) {
    log.info("未找到钱包，请先创建钱包: 'npm run autoref'");
    return;
  }

  log.info("启动程序，处理所有钱包数量:", wallets.length);
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
                const address = message.address;
                localStorage[address] = {
                  ...localStorage[address],
                  tasks: [...(localStorage[address]?.tasks || []), message.value],
                };
              }
              resolve();
            });
            worker.on("error", (error) => {
              log.error(`账户 ${currentIndex} 的 Worker 出错: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`账户 ${currentIndex} 的 Worker 退出，代码: ${code}`);
              }
              resolve();
            });
          })
        );
        currentIndex++;
      }

      await Promise.all(workerPromises);
      if (errors.length > 0) errors.length = 0;
      if (currentIndex < wallets.length) await delay(3);
    }
    await fs.writeFile("localStorage.json", JSON.stringify(localStorage, null, 4));
    log.warn(`所有钱包处理完毕，等待 20 小时后下次运行...`);
    await delay(20 * 60 * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    log.error("程序出错:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
