import fs from "fs/promises";
import chalk from "chalk";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

// 横幅
export const banner = `关注X: https://x.com/qklxsqf 获得更多资讯`;

// 日志工具
const logger = {
  log: (level, message, value = "") => {
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const colors = {
      info: chalk.cyanBright,
      warn: chalk.yellow,
      error: chalk.red,
      success: chalk.blue,
      debug: chalk.magenta,
    };
    const color = colors[level] || chalk.white;
    const levelTags = {
      info: "[ 信息 ]",
      warn: "[ 警告 ]",
      error: "[ 错误 ]",
      success: "[ 成功 ]",
      debug: "[ 调试 ]",
    };
    const levelTag = levelTags[level] || "[ 未知 ]";
    const timestamp = `[ ${now} ]`;
    const formattedMessage = `${chalk.cyanBright("[ LayerEdge ]")} ${chalk.grey(timestamp)} ${color(levelTag)} ${message}`;
    let formattedValue = ` ${chalk.green(value)}`;
    if (level === "error") formattedValue = ` ${chalk.red(value)}`;
    else if (level === "warn") formattedValue = ` ${chalk.yellow(value)}`;
    if (typeof value === "object") {
      const valueColor = level === "error" ? chalk.red : chalk.green;
      formattedValue = ` ${valueColor(JSON.stringify(value))}`;
    }
    console.log(`${formattedMessage}${formattedValue}`);
  },
  info: (message, value = "") => logger.log("info", chalk.blue(message), value),
  warn: (message, value = "") => logger.log("warn", chalk.yellow(message), value),
  error: (message, value = "") => logger.log("error", chalk.red(message), value),
  success: (message, value = "") => logger.log("success", chalk.green(message), value),
  debug: (message, value = "") => logger.log("debug", chalk.magenta(message), value),
};

// 辅助函数
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms * 1000));
}

export async function readJson(filename, defaultValue = {}) {
  try {
    await fs.access(filename);
    const data = await fs.readFile(filename, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    logger.error(`读取 JSON 文件 ${filename} 失败: ${err.message}`);
    return defaultValue;
  }
}

export async function saveToFile(filename, data) {
  try {
    await fs.appendFile(filename, `${data}\n`, "utf-8");
    logger.info(`数据已保存至 ${filename}`);
  } catch (error) {
    logger.error(`保存数据到 ${filename} 失败: ${error.message}`);
  }
}

export async function saveJson(initData, id, value, filename) {
  initData[id] = {
    ...initData[id],
    tasks: [...(initData[id]?.tasks || []), value],
  };
  await fs.writeFile(filename, JSON.stringify(initData, null, 4));
}

export async function readFile(pathFile) {
  try {
    const datas = await fs.readFile(pathFile, "utf8");
    return datas.split("\n").map((data) => data.trim()).filter((data) => data.length > 0);
  } catch (error) {
    logger.error(`读取文件失败: ${error.message}`);
    return [];
  }
}

export const newAgent = (proxy = null) => {
  if (proxy) {
    if (proxy.startsWith("http://") || proxy.startsWith("https://")) {
      return new HttpsProxyAgent(proxy);
    } else if (proxy.startsWith("socks4://") || proxy.startsWith("socks5://")) {
      return new SocksProxyAgent(proxy);
    } else {
      logger.warn(`不支持的代理类型: ${proxy}`);
      return null;
    }
  }
  return null;
};

export default logger;
