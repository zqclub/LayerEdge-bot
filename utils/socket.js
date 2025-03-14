import axios from "axios";
import { ethers, Wallet } from "ethers";
import chalk from "chalk";
import log from "./tools.js";
import { newAgent, saveJson, delay } from "./tools.js";
import { config } from "../config.js";

const solve2Captcha = async (proxy) => {
  let retries = 5;
  try {
    const { data: taskResponse } = await axios.post(
      "https://api.2captcha.com/createTask",
      {
        clientKey: config.API_KEY_2CAPTCHA,
        task: {
          type: "RecaptchaV3TaskProxyless",
          websiteURL: config.CAPTCHA_URL,
          websiteKey: config.WEBSITE_KEY,
        },
      },
      { headers: { "Content-Type": "application/json" }, httpsAgent: newAgent(proxy) }
    );
    const requestId = taskResponse.taskId;
    let result;
    do {
      await delay(10);
      const { data: resultResponse } = await axios.post(
        "https://api.2captcha.com/getTaskResult",
        { clientKey: config.API_KEY_2CAPTCHA, taskId: requestId },
        { headers: { "Content-Type": "application/json" }, httpsAgent: newAgent(proxy) }
      );
      result = resultResponse;
      if (result.status === "processing") log.warn("验证码仍在处理中...");
      retries--;
    } while (result.status === "processing" && retries > 0);
    if (result.status === "ready") {
      log.info("验证码解决成功");
      return result.solution.token;
    } else {
      log.error("验证码解决失败:", result);
      return null;
    }
  } catch (error) {
    log.error("验证码处理出错:", error.message);
    return null;
  }
};

const solveCaptcha = async (proxy) => {
  if (config.TYPE_CAPTCHA === "2captcha") {
    return await solve2Captcha(proxy);
  } else {
    log.warn("当前仅支持 2Captcha");
    return null;
  }
};

// LayerEdgeConnection 类
class LayerEdgeConnection {
  constructor(proxy = null, privateKey = null, refCode = "cvIwhX0T", localStorage, tasks) {
    this.refCode = refCode || config.ref_code;
    this.proxy = proxy;
    this.privateKey = privateKey;
    this.localStorage = localStorage;
    this.tasks = tasks;
    this.axiosConfig = {
      ...(this.proxy && { httpsAgent: newAgent(this.proxy) }),
      timeout: 60000,
    };
    this.wallet = privateKey ? new Wallet(privateKey) : Wallet.createRandom();
  }

  getWallet() {
    return this.wallet;
  }

  async makeRequest(method, url, config = {}, retries = 20) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios({
          method,
          url,
          headers: {
            Accept: "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Content-Type": "application/json",
            Origin: "https://dashboard.layeredge.io",
            Referer: "https://dashboard.layeredge.io/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          },
          ...this.axiosConfig,
          ...config,
        });
        return response;
      } catch (error) {
        if (error?.response?.status === 404 || error?.status === 404) {
          log.error(`LayerEdge 连接失败，钱包尚未注册...`);
          return 404;
        }
        if (error?.response?.status === 400) {
          log.error(`请求 ${url} 参数无效...`);
          return 400;
        } else if (error.response?.status === 409 && url.startsWith("https://referralapi.layeredge.io/api/task")) {
          return error.response.data;
        } else if (error.response?.status === 429) {
          log.error(`LayerEdge 请求超限...`);
          await delay(60);
          continue;
        } else if (i === retries - 1) {
          log.error(`达到最大重试次数 - 请求失败:`, error.message);
          if (error.response) log.error(`服务器响应:`, error.response.data);
          if (this.proxy) log.error(`代理 ${this.proxy} 失败:`, error.message);
          return null;
        }
        process.stdout.write(chalk.yellow(`请求失败: ${error.message} => 重试中... (${i + 1}/${retries})\r`));
        await delay(2);
      }
    }
    return null;
  }

  async checkInvite() {
    const inviteData = { invite_code: this.refCode };
    const response = await this.makeRequest("post", "https://referralapi.layeredge.io/api/referral/verify-referral-code", { data: inviteData });
    if (response && response.data && response.data.data.valid === true) {
      log.info("邀请码有效", response.data);
      return true;
    } else {
      log.error("检查邀请码失败");
      return false;
    }
  }

  async registerWallet() {
    const registerData = { walletAddress: this.wallet.address };
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/referral/register-wallet/${this.refCode}`, { data: registerData });
    if (response && response.data) {
      log.info("钱包注册成功", response.data);
      return true;
    } else {
      log.error("钱包注册失败", "错误");
      return false;
    }
  }

  async verifyCaptcha() {
    const token = await solveCaptcha(this.proxy);
    if (!token) {
      log.error("验证码解决失败");
      return false;
    }
    const response = await this.makeRequest("post", `https://dashboard.layeredge.io/api/verify-captcha`, { token });
    if (response && response.data) {
      log.info("验证码验证成功", response.data);
      return true;
    } else {
      log.error("验证码验证失败");
      return false;
    }
  }

  async connectNode() {
    const timestamp = Date.now();
    const message = `Node activation request for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const dataSign = { sign: sign, timestamp: timestamp };
    log.debug("发送连接节点请求，签名数据:", dataSign);
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/light-node/node-action/${this.wallet.address}/start`, { data: dataSign });
    if (response && response.data && response.data.message === "node action executed successfully") {
      log.info("节点连接成功", response.data);
      return true;
    } else {
      log.warn("节点连接失败");
      return false;
    }
  }

  generateRandomNumber(length = 19) {
    if (length < 1) return "";
    let result = "";
    const digits = "0123456789";
    result += Math.floor(Math.random() * 9) + 1;
    for (let i = 1; i < length; i++) {
      result += digits.charAt(Math.floor(Math.random() * digits.length));
    }
    return result;
  }

  async connectTwitter() {
    const timestamp = Date.now();
    const message = `Twitter verification request for ${this.wallet.address} at ${timestamp}`; // 使用英文签名，与最新版本一致
    const sign = await this.wallet.signMessage(message);
    const id = this.generateRandomNumber(); // 原先使用随机 ID
    const dataSign = { walletAddress: this.wallet.address, sign: sign, timestamp: timestamp, twitterId: id };
    log.debug("发送 Twitter 验证请求，签名数据:", dataSign);
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/task/connect-twitter`, { data: dataSign });
    if (response && response.data && response.data.message?.includes("verified")) {
      log.info("Twitter 连接成功", response.data);
      return true;
    } else {
      log.warn("Twitter 连接失败", response?.data || "无响应数据");
      return false;
    }
  }

  async handleTasks() {
    let allTasksCompleted = true;
    for (const task of this.tasks) {
      await delay(1);
      const tasksCompleted = this.localStorage[this.wallet.address]?.tasks || [];
      if (tasksCompleted.includes(task.id)) {
        log.info(`任务 ${task.title} 已完成，跳过`);
        continue;
      }
      const taskResult = await this.doTask(task);
      if (taskResult) {
        log.info(`任务 ${task.title} 处理成功`);
        await saveJson(this.localStorage, this.wallet.address, task.id, "localStorage.json");
      } else {
        log.warn(`任务 ${task.title} 处理失败，继续处理其他任务`);
        allTasksCompleted = false;
      }
    }
    if (allTasksCompleted) {
      log.info("所有任务已完成或跳过");
    } else {
      log.warn("部分任务处理失败，但流程继续");
    }
    return allTasksCompleted;
  }

  async doTask(task) {
    const timestamp = Date.now();
    const message = `Task ${task.id} request for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const dataSign = { sign: sign, timestamp: timestamp, walletAddress: this.wallet.address };
    log.debug(`发送任务 ${task.id} 请求，签名数据:`, dataSign);
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/task/${task.id}`, { data: dataSign });
    if (response && response.data) {
      if (response.data.message?.includes("successfully")) {
        log.info(`任务 ${task.title} 完成成功`, response.data);
        await saveJson(this.localStorage, this.wallet.address, task.id, "localStorage.json");
        return true;
      } else if (response.data.message?.includes("already completed")) {
        log.info(`任务 ${task.title} 已完成`, response.data);
        await saveJson(this.localStorage, this.wallet.address, task.id, "localStorage.json");
        return true;
      } else {
        log.warn(`任务 ${task.title} 完成失败`, response.data);
        return false;
      }
    } else {
      log.error(`任务 ${task.title} 请求失败，响应为空`);
      return false;
    }
  }

  async stopNode() {
    const timestamp = Date.now();
    const message = `Node deactivation request for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const dataSign = { sign: sign, timestamp: timestamp };
    log.debug("发送停止节点请求，签名数据:", dataSign);
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/light-node/node-action/${this.wallet.address}/stop`, { data: dataSign });
    if (response && response.data) {
      log.info("停止节点并领取积分结果:", response.data);
      return true;
    } else {
      log.warn("停止节点和领取积分失败");
      return false;
    }
  }

  async checkNodeStatus() {
    const response = await this.makeRequest("get", `https://referralapi.layeredge.io/api/light-node/node-status/${this.wallet.address}`);
    if (response === 404) {
      log.info("此钱包未找到节点，尝试注册钱包...");
      await this.registerWallet();
      return false;
    }
    if (response && response.data && response.data.data.startTimestamp !== null) {
      log.info("节点运行中", response.data);
      return true;
    } else {
      log.warn("节点未运行，尝试启动节点...");
      return false;
    }
  }

  async checkNodePoints() {
    const response = await this.makeRequest("get", `https://referralapi.layeredge.io/api/referral/wallet-details/${this.wallet.address}`);
    if (response && response.data) {
      const isTwitterVerified = response.data.data.isTwitterVerified;
      log.info(`${this.wallet.address} 总积分:`, response.data.data?.nodePoints || 0);
      log.debug(`Twitter 验证状态:`, isTwitterVerified);
      const lasCheckin = response.data.data?.lastClaimed;
      const isNewDate = new Date() - new Date(lasCheckin) > 24 * 60 * 60 * 1000;
      if (isNewDate || !lasCheckin) await this.checkIn();
      if (!isTwitterVerified) { 
        log.info(`尝试连接 Twitter...`);
        await this.connectTwitter();
      }
      return true;
    } else {
      log.error("检查总积分失败");
      return false;
    }
  }

  async checkIn() {
    const timestamp = Date.now();
    const message = `我在 ${timestamp} 为 ${this.wallet.address} 领取每日节点积分`;
    const sign = await this.wallet.signMessage(message);
    const dataSign = { sign: sign, timestamp: timestamp, walletAddress: this.wallet.address };
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/light-node/claim-node-points`, { data: dataSign });
    if (response && response.data) {
      log.info(`${this.wallet.address} 签到成功:`, response.data);
      return true;
    } else {
      log.error("签到失败");
      return false;
    }
  }
}

export default LayerEdgeConnection;
