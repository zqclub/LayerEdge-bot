import axios from "axios";
import chalk from "chalk";
import { ethers, Wallet } from "ethers";
import log from "./logger.js";
import { newAgent, readFile, saveJson, readJson, saveToFile } from "./helper.js";
import { ABI } from "./ABI.js";
import { config } from "../config.js";
import { solveCaptcha } from "./captcha.js";

const delay = async (s) => await new Promise((resolves) => setTimeout(resolves, s * 1000));
class LayerEdgeConnection {
  constructor(proxy = null, privateKey = null, refCode = "cvIwhX0T", localStorage, tasks) {
    this.refCode = refCode;
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
            "Accept-Language": "en-US,en;q=0.9",
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
          log.error(`Layer Edge connection failed wallet not registered yet...`);
          return 404;
        }
        if (error?.response?.status === 400) {
          log.error(`Invalid param for request ${url}...`);
          return 400;
        } else if (error.response?.status === 409 && url.startsWith("https://referralapi.layeredge.io/api/task")) {
          return error.response.data;
        } else if (error.response?.status === 429) {
          log.error(chalk.red(`Layer Edge rate limit exceeded...`));
          await delay(60);
          continue;
        } else if (i === retries - 1) {
          log.error(`Max retries reached - Request failed:`, error.message);
          if (this.proxy) {
            log.error(`Failed proxy: ${this.proxy}`, error.message);
          }
          return null;
        }

        process.stdout.write(chalk.yellow(`request failed: ${error.message} => Retrying... (${i + 1}/${retries})\r`));
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    return null;
  }

  async checkInvite() {
    const inviteData = {
      invite_code: this.refCode,
    };

    const response = await this.makeRequest("post", "https://referralapi.layeredge.io/api/referral/verify-referral-code", { data: inviteData });

    if (response && response.data && response.data.data.valid === true) {
      log.info("Invite Code Valid", response.data);
      return true;
    } else {
      log.error("Failed to check invite");
      return false;
    }
  }

  async registerWallet() {
    const registerData = {
      walletAddress: this.wallet.address,
    };

    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/referral/register-wallet/${this.refCode}`, { data: registerData });

    if (response && response.data) {
      log.info("Wallet successfully registered", response.data);
      return true;
    } else {
      log.error("Failed To Register wallets", "error");
      return false;
    }
  }

  async verifyCaptcha() {
    const token = await solveCaptcha();
    if (!token) {
      log.error("Failed to solve captcha");
      return false;
    }
    const response = await this.makeRequest("post", `https://dashboard.layeredge.io/api/verify-captcha`, { token });
    if (response && response.data) {
      log.info("Verify captcha successfully", response.data);
      return true;
    } else {
      log.error("Failed To Register wallets", "error");
      return false;
    }
  }

  async connectNode() {
    //     {
    //     "sign": "0xf03d458cc32c5c29b36e432d7204b92bb265ea3619c88699a575e4415804f7c334a8a3f8282cf3edb1aaecef4ec73893f909e27aba31ca01ddf0f1c9572bbc001b",
    //         "timestamp": 1741707873129
    //       'token':"03AFcWeA698bfe2rx4ecbEwAMItjTPHcr7gCP7lPr_gpxR2rjSJm8XXM7InQ8ZfRoxMR1daI9_e3I5tAWQh20lnFL4WgyFfCTasVv0ApcctCxYNvofsuDsxAsk-VpYy7GMHALAX8s9ztQLD1_L4Ax4hQ5TwFMwFrBsFIxYrInE8Hl7gxesJt8DSY85Y1r1aPBeGlmFaM7QfkCvUBKWweMBmbSOfwmnwc-BAr1RWPp2Kn7tpd1HeSsu57ypAK3Wn8PT7oRiaYSpDgogLBXZgdJHz0v482DRLZF1x5b8oMl91d-7F162hloTad4OexwBMGvx2fkUj6WDm21GY7RdDMBcaYILEI_pCu31Sv6WaSgvfq5Umzt37jCq9pwBDcSbhRcMXciEDAxV5-R1O4i12cKRCS7xnR_7wokZsbF3BxFy03NgiYm5CW9ZwClva9xO5Zl6gcLjAZrKFTBsB1og1iftGuWjtzXBWigoGWw9SuEKn7g1cdIPezV-xKtV5_l2zR9hkqu8Q-kB7Zi3dzcgSc_b5KbkyLUbXNnLOpK0FAgXKgx9_OzH2OgRz0UDYleqWZ7NM8fAaKNGAgXWo5mFqDDhnCZ3fALAlagAvL8diTIjqwHw_-__5a3dOFo0LzExqXmjykpjfqXA8ZHmNTWZMjOC8XkmZQMPbsOIf-ZcKUVE1KMCtOLnZF6gZZ4U3pQsfvWnSktsqRM8Ca0pggCWEcRzQiWyp9qrsXrFtepjkG_KyhQbY60hGfmoXCodIoFlr8dm8Xfhhjm5mm2cjEgKK3fZEYlp3V3CdSYzzKV0kszP-88VutAjFeK4DvlQtqtl6Gdgd7giBQnkY-a3rSa5PrP0-1uoOj6x-vppAUtVlk5xNpjC7AX4NNL2PpltAukNrVF45r23FWn566XvHnKH7SkrAoQ3UQ6B3PjDaPlQzIM20TB9MLeAF76_IxHARZWk6K2No7CyuR-Sp7S8Q5R4LNUyCmlb1qycmSAzFgRGd26Ik0DkFZ2v08COGsMA1codwsnxiHvDGcwLC9mWCGzh-hpN8Lou4hteAoSJnyQ8x5VS8PIHrYz8CvRp9th0LCI00Ns8PK04zJ5I6fb7aeNq1Lx7HCgb_oh8d3IbSthvMENvfofulq426glVWMQJdN4tx2-FloTFi2GDfdtGq-cmeONk6KGTGp5hsEF6_Tha9mH9DuK_w2Q1b4uQq6p2sIxtITTFRXqvu7hPqF-NVCCOxjTYaacqWlZME62G_j6tUDXdjamGeipQnE7PtMv-2RuL7P56U4R5S38ncS2QvMFRYUBCcFICVi3Yvzh-ieDgxIBCG1GEIV2xGPjI8CUUzKRRbsp-3PalvKhzp8Buk6UHMvZXeooQs22RC6BxE4hv-MXY9J8irhSMo97NRQ55NbLRaZnkRl3PiPHlEtnsj907l4cKfymuaTMzpfIPLv_GFym_V5mdsxXZtbYussJgmbcUmQeUdRw-sVVo2y61x9dmAxGSlrdDodjWY8y9hpiz2DKjF1yFktfGYojCTQw3M-0HCQzHQjrcfwSCfagmFOx6Vw7X5t6u09IjWwtr42V_NMo507eYQtPXvuNeoyAC6OsHOgq9hHMcGGAGOIlQ9e9q5IF6OV24iqaKlVTZX4IOL6YEKWnMk4dO53BZtcqjLV_EMgP6gYWXqwM_Vh_i63BpJtM1FhwNsog4xy7zHhzzAIoQ9UUh7mW__JVTR68SeU_F0WnrpN7-eAhLkszZsBsx9ZhMZYF1aKFVPnY4gshBw0X_aXFoVJ8f2wEaAiZbzrTqwDjbaSAIEaW5y-XSmKSSB_dSNOqSDLPifYkArOlN4E1U1pyFMi9ShP_MZzJtfph56NRxIqUJ9RjxHfEyfmw7WDKH3bLWXj_VjzKH8b1EkfhuiLSx9cYBS4S_qcRJJzyL-hQYackiJM8m9LHwI7B5Sk7biWPJwRgbaq_XwNSSEOBlv2y-lc5EMECvxAyxFLANBjPa1po1xDEeOgno4wWYdCruZhh6Zi5VWcYeAvoWbgVJAx6qCsX-C_Z_cQ_32kauJhfjUhIdfJjETXg89KN_QoQb-q3kldTg_XZgcERx1pDNLje-t0t51vAK590HHvqng0IdFEoOlp93BSc5Kby8d48p5LX31Fc3CmBIZKswLDhlPaftWFMmxLgry8wBPtDp_35xqHT4f-ltQo5u24j2NS0NEeC4zRy8sXhKqwf2_JjWwRPF0ac6hGvDme8"
    // }
    const timestamp = Date.now();
    const message = `Node activation request for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);

    const dataSign = {
      sign: sign,
      timestamp: timestamp,
    };

    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/light-node/node-action/${this.wallet.address}/start`, { data: dataSign });

    if (response && response.data && response.data.message === "node action executed successfully") {
      log.info("Connected Node Successfully", response.data);
      return true;
    } else {
      log.warn("Failed to connect Node");
      return false;
    }
  }

  generateRandomNumber(length = 19) {
    if (length < 1) return "";

    let result = "";
    const digits = "0123456789";

    // Chọn số đầu tiên không phải là 0
    result += Math.floor(Math.random() * 9) + 1; // 1-9

    // Chọn các số còn lại
    for (let i = 1; i < length; i++) {
      result += digits.charAt(Math.floor(Math.random() * digits.length));
    }

    return result;
  }

  async connectTwitter() {
    const timestamp = Date.now();
    const message = `I am verifying my Twitter authentication for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const id = this.generateRandomNumber();
    const dataSign = {
      walletAddress: this.wallet.address,
      sign: sign,
      timestamp: timestamp,
      twitterId: id,
    };

    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/task/connect-twitter`, { data: dataSign });

    if (response && response.data && response.data.message.includes("verified")) {
      log.info("Connected twitter Successfully", response.data);
      return true;
    } else {
      log.warn("Failed to connect Node", response);
      return false;
    }
  }

  async getProofStatus(task) {
    const response = await this.makeRequest("get", `https://staging-referralapi.layeredge.io/api/card/proof-status/${this.wallet.address}`);
    if (response && response.data) {
      const submited = response.data.data.hasSubmitted;
      const isCardGenerated = response.data.data.isCardGenerated;
      if (submited === false) {
        return await this.submitProof(task);
      } else if (isCardGenerated === false) {
        const res = await this.generateCard();
        if (res) return await this.doTask(task);
        return false;
      } else if (submited && isCardGenerated) {
        return await this.doTask(task);
      }
      return true;
    } else {
      return false;
    }
  }

  async submitProof() {
    const timestamp = new Date();
    const message = `I am submitting a proof for LayerEdge at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const dataSign = {
      message: message,
      signature: sign,
      address: this.wallet.address,
      proof: `Hi, my wallet address ${this.wallet.address}. I'm verified submit proof`,
    };
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/card/submit-proof`, { data: dataSign });
    if (response && response.data) {
      log.info("Submit Proof Success: ", response.data);
      // await this.generateCard();
      // return await this.doTask();
      return false;
    } else {
      log.warn("Failed to submit proof");
      return false;
    }
  }
  async generateCard() {
    const response = await this.makeRequest("post", `https://staging-referralapi.layeredge.io/api/card/shareable-card`, {
      data: {
        walletAddress: this.wallet.address,
      },
    });
    if (response && response.data) {
      log.info("Generate card success: ", response.data);
      return true;
    } else {
      log.error("Failed to generate card");
      return false;
    }
  }

  async handleTasks() {
    for (const task of this.tasks) {
      await delay(1);
      const tasksCompleted = this.localStorage[this.wallet.address]?.tasks || [];
      if (tasksCompleted.includes(task.id)) {
        continue;
      }
      if (task.id === "proof-submission") {
        return await this.getProofStatus(task);
      } else {
        return this.doTask(task);
      }
    }
  }

  async doTask(task) {
    const timestamp = Date.now();
    const message = `${task.message} ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);
    const dataSign = {
      sign: sign,
      timestamp: timestamp,
      walletAddress: this.wallet.address,
    };
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/task/${task.id}`, { data: dataSign });
    if (response && response.data && response.data.message?.includes("successfully")) {
      log.info(`Completed Task ${task.title} Successfully`, response.data);
      await saveJson(this.localStorage, this.wallet.address, task.id, "localStorage.json");
      return task.id;
    } else {
      log.warn(`Failed to Completed Task ${task.title}`, response);
      if (response == 404 && task.id == "nft-verification/1") {
        const resMint = await this.handleMintNFT();
        if (resMint) {
          await this.doTask(task);
        }
      } else if (response.message?.includes("already completed")) {
        await saveJson(this.localStorage, this.wallet.address, task.id, "localStorage.json");
        return task.id;
      }
      return false;
    }
  }

  async handleMintNFT() {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const wallet = new ethers.Wallet(this.privateKey, provider);
    const contractAddress = "0xb06C68C8f9DE60107eAbda0D7567743967113360";
    const contractABI = ABI;
    const nftContract = new ethers.Contract(contractAddress, contractABI, wallet);
    const allowlistProof = [
      [], // proof (mảng rỗng nếu không có proof)
      0, // quantityLimitPerWallet
      ethers.constants.MaxUint256, // pricePerToken (giá trị tối đa)
      ethers.constants.AddressZero, // currency address
    ];
    try {
      const tx = await nftContract.claim(
        wallet.address, // receiver
        1, // quantity
        ethers.AddressZero, // currency (nếu mint miễn phí)
        0, // giá trị pricePerToken là 0
        allowlistProof, // allowlistProof
        "0x" // data
      );

      // const tx = await nftContract.mintNFT("0xb06c68c8f9de60107eabda0d7567743967113360");
      log.info("Minting NFT... Transaction Hash:", tx.hash);
      // Chờ giao dịch xác nhận
      await tx.wait();
      log.success(`NFT minted successfully! Hash: https://basescan.org/tx/${tx.hash}`);
      return true;
    } catch (error) {
      console.error("Error minting NFT:", error.message);
      return false;
    }
  }

  async stopNode() {
    const timestamp = Date.now();
    const message = `Node deactivation request for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);

    const dataSign = {
      sign: sign,
      timestamp: timestamp,
    };

    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/light-node/node-action/${this.wallet.address}/stop`, { data: dataSign });

    if (response && response.data) {
      log.info("Stop and Claim Points Result:", response.data);
      return true;
    } else {
      log.warn("Failed to Stopping Node and claiming points");
      return false;
    }
  }

  async checkNodeStatus() {
    const response = await this.makeRequest("get", `https://referralapi.layeredge.io/api/light-node/node-status/${this.wallet.address}`);

    if (response === 404) {
      log.info("Node not found in this wallet, trying to regitering wallet...");
      await this.registerWallet();
      return false;
    }

    if (response && response.data && response.data.data.startTimestamp !== null) {
      log.info("Node Status Running", response.data);
      // // Thời gian cho trước (timestamp)
      // const givenTimestamp = response.data.data.startTimestamp * 1000; // Chuyển đổi từ giây sang mili giây
      // // Lấy thời gian hiện tại
      // const currentTime = Date.now();
      // // Kiểm tra xem đã qua 24 giờ hay chưa
      // const twentyFourHoursInMillis = 24 * 60 * 60 * 1000; // 24 giờ tính bằng mili giây
      // const hasPassed24Hours = currentTime - givenTimestamp > twentyFourHoursInMillis;
      // if (hasPassed24Hours) {
      //   return true;
      // }
      return true;
    } else {
      log.warn("Node not running trying to start node...");
    }
    return false;
  }

  async checkNodePoints() {
    const response = await this.makeRequest("get", `https://referralapi.layeredge.io/api/referral/wallet-details/${this.wallet.address}`);
    if (response && response.data) {
      const isTwitterVerified = response.data.data.isTwitterVerified;
      log.info(`${this.wallet.address} Total Points:`, response.data.data?.nodePoints || 0);
      const lasCheckin = response.data.data?.lastClaimed;
      const isNewDate = new Date() - new Date(lasCheckin) > 24 * 60 * 60 * 1000;
      if (isNewDate || !lasCheckin) {
        await this.checkIn();
      }
      if (!isTwitterVerified) {
        log.info(`Trying connect twitter...`);
        await this.connectTwitter();
      }
      return true;
    } else {
      log.error("Failed to check Total Points..");
      return false;
    }
  }

  async checkIn() {
    const timestamp = Date.now();
    const message = `I am claiming my daily node point for ${this.wallet.address} at ${timestamp}`;
    const sign = await this.wallet.signMessage(message);

    const dataSign = {
      sign: sign,
      timestamp: timestamp,
      walletAddress: this.wallet.address,
    };
    const response = await this.makeRequest("post", `https://referralapi.layeredge.io/api/light-node/claim-node-points`, { data: dataSign });
    if (response && response.data) {
      log.info(`${this.wallet.address} Checkin success:`, response.data);
      return true;
    } else {
      log.error("Failed to check in..");
      return false;
    }
  }
}

export default LayerEdgeConnection;
