import chalk from "chalk";

const logger = {
  log: (level, message, value = "") => {
    const now = new Date().toLocaleString();

    const colors = {
      info: chalk.cyanBright,
      warn: chalk.yellow,
      error: chalk.red,
      success: chalk.blue,
      debug: chalk.magenta,
    };

    const color = colors[level] || chalk.white;
    const levelTag = `[ ${level.toUpperCase()} ]`;
    const timestamp = `[ ${now} ]`;

    const formattedMessage = `${chalk.cyanBright("[ LayerEdge ]")} ${chalk.grey(timestamp)} ${color(levelTag)} ${message}`;

    let formattedValue = ` ${chalk.green(value)}`;
    if (level === "error") {
      formattedValue = ` ${chalk.red(value)}`;
    } else if (level === "warn") {
      formattedValue = ` ${chalk.yellow(value)}`;
    }
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

export default logger;
