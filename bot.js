import fs from "fs";
import { ethers } from "ethers";
import chalk from "chalk";

function getCurrentTime() {
  const now = new Date(new Date().getTime() + 7 * 3600 * 1000);
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const mth = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const yyyy = now.getUTCFullYear();
  return chalk.blue(`[${hh}:${mm}:${ss} ${dd}/${mth}/${yyyy}]`);
}

const ABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "_tier", "type": "uint256" },
      { "internalType": "address", "name": "_to", "type": "address" }
    ],
    "name": "mint",
    "outputs": [
      { "internalType": "uint256", "name": "", "type": "uint256" }
    ],
    "stateMutability": "payable",
    "type": "function"
  }
];

const CONTRACT_ADDRESS = "0xb06C68C8f9DE60107eAbda0D7567743967113360";
const TIER = 1;
const provider = new ethers.JsonRpcProvider("https://1rpc.io/base");

async function main() {
  const walletLines = fs.readFileSync("wallets.txt", "utf-8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  const privLines = fs.readFileSync("priv.txt", "utf-8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (walletLines.length !== privLines.length) {
    console.error(getCurrentTime(), chalk.red("wallets.txt 和 priv.txt 的行数不匹配，退出..."));
    process.exit(1);
  }

  for (let i = 0; i < walletLines.length; i++) {
    const walletAddress = walletLines[i];
    const privateKey = privLines[i];
    try {
      console.log(getCurrentTime(), chalk.yellow(`[${i + 1}] 开始为地址铸造: ${walletAddress}`));
      const signer = new ethers.Wallet(privateKey, provider);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
      const txData = contract.interface.encodeFunctionData("mint", [TIER, walletAddress]);
      const txForEstimate = {
        from: signer.address,
        to: CONTRACT_ADDRESS,
        data: txData
      };
      const estimatedGas = await provider.estimateGas(txForEstimate);
      const gasLimit = (estimatedGas * 110n) / 100n;
      // console.log(getCurrentTime(), chalk.cyan(`估算燃气: ${estimatedGas.toString()}, 使用燃气限制: ${gasLimit.toString()}`));
      const tx = await signer.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: txData,
        gasLimit: gasLimit
      });
      console.log(getCurrentTime(), chalk.cyan(`交易已发送，交易哈希 = ${tx.hash}。等待确认...`));

      let receipt;
      try {
        receipt = await tx.wait();
      } catch (e) {
        if (e.message && e.message.includes("cannot unmarshal string into Go struct field Response.error")) {
          console.log(getCurrentTime(), chalk.green(`交易确认出错已忽略。假设交易成功，交易哈希: ${tx.hash}`));
          receipt = { status: 1, blockNumber: "未知" };
        } else {
          throw e;
        }
      }

      if (receipt.status === 1) {
        console.log(getCurrentTime(), chalk.green(`铸造成功！区块: ${receipt.blockNumber}, 交易哈希: ${tx.hash}`));
        const successLine = `${walletAddress}:${privateKey}:${tx.hash}\n`;
        fs.appendFileSync("success.txt", successLine, { encoding: "utf-8" });
      } else {
        console.log(getCurrentTime(), chalk.red(`交易失败 (状态 = 0)，交易哈希: ${tx.hash}`));
      }
    } catch (err) {
      console.error(getCurrentTime(), chalk.red(`[${i + 1}] 为 ${walletAddress} 铸造时出错:`), err);
    }
    console.log(getCurrentTime(), chalk.magenta("============================================\n"));
  }
  console.log(getCurrentTime(), chalk.green("铸造过程已完成！"));
}

main().catch(err => {
  console.error(getCurrentTime(), chalk.red("脚本运行出错:"), err);
});
