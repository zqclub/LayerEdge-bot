import asyncio
from random import randint
import json
import os
from web3 import AsyncWeb3, AsyncHTTPProvider
from colorama import Fore, init

# 初始化颜色支持
init()

# 配置
CONTRACT_ADDRESS = "0xb06C68C8f9DE60107eAbda0D7567743967113360"
RPC_URL = "https://mainnet.base.org"  # 可改为 https://1rpc.io/base
MIN_DELAY = 5  # 账户间最小延迟（秒）
MAX_DELAY = 10  # 账户间最大延迟（秒）
OG_VALUE = "0.000909"  # OG NFT 费用（ETH）
ABI_PATH = "free_mint_abi.json"

w3 = AsyncWeb3(AsyncHTTPProvider(RPC_URL))

# 日志工具
class Logger:
    @staticmethod
    def info(msg): print(f"{Fore.CYAN}[INFO] {msg}{Fore.RESET}")
    @staticmethod
    def success(msg): print(f"{Fore.GREEN}[SUCCESS] {msg}{Fore.RESET}")
    @staticmethod
    def error(msg): print(f"{Fore.RED}[ERROR] {msg}{Fore.RESET}")

# 文件工具
def read_wallets():
    if os.path.exists("wallets.txt") and os.path.exists("priv.txt"):
        with open("wallets.txt", "r") as f:
            wallets = [line.strip() for line in f if line.strip()]
        with open("priv.txt", "r") as f:
            privs = [line.strip() for line in f if line.strip()]
        if len(wallets) != len(privs):
            raise ValueError("wallets.txt 和 priv.txt 行数不匹配")
        return [{"address": w, "private_key": p} for w, p in zip(wallets, privs)]
    elif os.path.exists("private_keys.txt"):
        with open("private_keys.txt", "r") as f:
            return [{"address": None, "private_key": line.strip()} for line in f if line.strip()]
    else:
        raise FileNotFoundError("未找到 wallets.txt/priv.txt 或 private_keys.txt")

def write_success(wallet, tx_hash):
    with open("success.txt", "a") as f:
        f.write(f"{wallet['address']}:{wallet['private_key']}:{tx_hash}\n")

def write_failure(wallet):
    with open("failed.txt", "a") as f:
        f.write(f"{wallet['address'] or 'unknown'}:{wallet['private_key']}\n")

# 读取 ABI
def load_abi(path):
    with open(path, "r") as f:
        return json.load(f)

# 构造交易
async def build_transaction(wallet, tier, value=0):
    wallet_address = w3.to_checksum_address(wallet["address"] or w3.eth.account.from_key(wallet["private_key"]).address)
    contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=load_abi(ABI_PATH))
    
    last_block = await w3.eth.get_block("latest")
    base_fee = int(last_block["baseFeePerGas"] * 1.3)
    max_priority_fee = await w3.eth.max_priority_fee
    gas_estimate = await contract.functions.mint(tier, wallet_address).estimate_gas({"from": wallet_address})
    gas_limit = int(gas_estimate * 1.1)

    return {
        "chainId": await w3.eth.chain_id,
        "from": wallet_address,
        "to": CONTRACT_ADDRESS,
        "maxPriorityFeePerGas": max_priority_fee,
        "maxFeePerGas": base_fee + max_priority_fee,
        "gas": gas_limit,
        "nonce": await w3.eth.get_transaction_count(wallet_address),
        "data": contract.encodeABI(fn_name="mint", args=[tier, wallet_address]),
        "value": w3.to_wei(value, "ether"),
    }

# 发送交易
async def send_transaction(txn, wallet, nft_type):
    try:
        signed_txn = w3.eth.account.sign_transaction(txn, wallet["private_key"])
        tx_hash = await w3.eth.send_raw_transaction(signed_txn.rawTransaction)
        receipt = await w3.eth.wait_for_transaction_receipt(tx_hash)
        if receipt["status"] == 1:
            Logger.success(f"{wallet['address']} | 铸造 {nft_type} | 交易哈希: {tx_hash.hex()}")
            write_success(wallet, tx_hash.hex())
        else:
            Logger.error(f"{wallet['address']} | 铸造 {nft_type} | 交易失败 (状态=0)")
            write_failure(wallet)
    except Exception as e:
        Logger.error(f"{wallet['address']} | 铸造 {nft_type} | 错误: {str(e)}")
        write_failure(wallet)

# 铸造 NFT
async def mint_nft(wallet, mint_free, mint_og):
    if mint_free:
        Logger.info(f"{wallet['address']} | 开始铸造免费通行证")
        txn = await build_transaction(wallet, 1)
        await send_transaction(txn, wallet, "免费通行证")
        await asyncio.sleep(0.1)

    if mint_og:
        if mint_free:
            await asyncio.sleep(randint(60, 90))  # FREE 和 OG 间延迟
        Logger.info(f"{wallet['address']} | 开始铸造 OG 通行证")
        txn = await build_transaction(wallet, 2, OG_VALUE)
        await send_transaction(txn, wallet, "OG 通行证")

# 获取用户选择
def get_user_choice():
    print("请选择要铸造的 NFT 类型：")
    print("1. 免费通行证 (Free Pass)")
    print("2. OG 通行证 (OG Pass, 费用: 0.000909 ETH)")
    print("3. 两者都铸造")
    while True:
        choice = input("输入选项 (1/2/3): ").strip()
        if choice == "1":
            return True, False  # 只铸造免费
        elif choice == "2":
            return False, True  # 只铸造 OG
        elif choice == "3":
            return True, True   # 两者都铸造
        else:
            print("无效选项，请输入 1、2 或 3")

# 主函数
async def main():
    # 获取用户选择
    mint_free, mint_og = get_user_choice()
    Logger.info(f"选择铸造: 免费={'是' if mint_free else '否'}, OG={'是' if mint_og else '否'}")

    wallets = read_wallets()
    tasks = []
    for wallet in wallets:
        task = asyncio.create_task(mint_nft(wallet, mint_free, mint_og))
        tasks.append(task)
        await asyncio.sleep(randint(MIN_DELAY, MAX_DELAY))

    await asyncio.gather(*tasks)
    Logger.success("所有账户处理完成！")

if __name__ == "__main__":
    asyncio.run(main())
