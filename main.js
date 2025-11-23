// main.js
import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || window?.__BACKEND_URL__ || "https://kamoaze10.onrender.com";
const NFT_CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT || window?.__NFT_CONTRACT__ || "0x54a88333F6e7540eA982261301309048aC431eD5";
const SEAPORT_CONTRACT_ADDRESS = import.meta.env.VITE_SEAPORT_CONTRACT || window?.__SEAPORT_CONTRACT__ || "0x0000000000000068F116a894984e2DB1123eB395";

const APECHAIN_ID = 33139;
const APECHAIN_ID_HEX = "0x8173";

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");

function notify(msg, timeout = 3500) {
  noticeDiv.textContent = msg;
  if (timeout)
    setTimeout(() => {
      if (noticeDiv.textContent === msg) noticeDiv.textContent = "";
    }, timeout);
}

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask tapılmadı!");
    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();

    const network = await provider.getNetwork();
    if (network.chainId !== APECHAIN_ID) {
      try {
        await provider.send("wallet_addEthereumChain", [
          {
            chainId: APECHAIN_ID_HEX,
            chainName: "ApeChain Mainnet",
            nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
            rpcUrls: [import.meta.env.APECHAIN_RPC || "https://rpc.apechain.com"],
            blockExplorerUrls: ["https://apescan.io"],
          },
        ]);
        notify("Şəbəkə əlavə edildi, yenidən qoşun.");
        return;
      } catch (e) {
        console.error(e);
      }
    }

    seaport = new Seaport(signer, { contractAddress: SEAPORT_CONTRACT_ADDRESS });

    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = userAddress.slice(0, 6) + "..." + userAddress.slice(-4);

    await loadNFTs();
  } catch (err) {
    console.error(err);
    alert("Wallet connect xətası!");
  }
}

disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Cüzdan ayırıldı", 2000);
};
connectBtn.onclick = connectWallet;

let loadingNFTs = false;
let loadedCount = 0;
const BATCH_SIZE = 12;
let allNFTs = [];

async function loadNFTs() {
  if (loadingNFTs) return;
  loadingNFTs = true;

  try {
    if (allNFTs.length === 0) {
      const res = await fetch(`${BACKEND_URL}/api/nfts`);
      const data = await res.json();
      allNFTs = data.nfts || [];
    }

    if (loadedCount >= allNFTs.length) {
      if (loadedCount === 0)
        marketplaceDiv.innerHTML = "<p>Bu səhifədə NFT yoxdur.</p>";
      return;
    }

    const batch = allNFTs.slice(loadedCount, loadedCount + BATCH_SIZE);
    loadedCount += batch.length;

    for (const nft of batch) {
      const tokenid = nft.tokenid;
      let name = nft.name || `Bear #${tokenid}`;
      let image = nft.image || "https://ipfs.io/ipfs/QmExampleNFTImage/default.png";
      if (image && image.startsWith("ipfs://")) image = image.replace("ipfs://", "https://ipfs.io/ipfs/");

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="${image}" alt="NFT image"
          onerror="this.src='https://ipfs.io/ipfs/QmExampleNFTImage/default.png'">
        <h4>${name}</h4>
        <p class="price">Qiymət: ${nft.price ?? '-' } APE</p>
        <div class="nft-actions">
          <input type="number" min="0" step="0.01" class="price-input" placeholder="Qiymət (APE)">
          <button class="wallet-btn buy-btn" data-id="${tokenid}">Buy</button>
          <button class="wallet-btn list-btn" data-token="${tokenid}">List</button>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      card.querySelector(".buy-btn").onclick = async (ev) => {
        ev.target.disabled = true;
        await buyNFT(nft).catch(console.error);
        ev.target.disabled = false;
      };

      // ✅ List düyməsi BigNumber xətasından təmizlənmiş
      card.querySelector(".list-btn").onclick = async (ev) => {
        ev.target.disabled = true;
        const priceInput = card.querySelector(".price-input");
        const priceStr = priceInput.value?.trim();

        if (!priceStr) {
          notify("Qiymət boşdur, listing ləğv edildi.");
          ev.target.disabled = false;
          return;
        }

        let priceWei;
        try {
          priceWei = ethers.utils.parseEther(priceStr);
        } catch (err) {
          notify("Qiymət düzgün formatda deyil, listing ləğv edildi.");
          ev.target.disabled = false;
          return;
        }

        await listNFT(tokenid, priceWei, card).catch(console.error);
        ev.target.disabled = false;
      };
    }
  } catch (err) {
    console.error(err);
    if (loadedCount === 0) marketplaceDiv.innerHTML = "<p>Xəta baş verdi.</p>";
  } finally {
    loadingNFTs = false;
  }
}

window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 300)
    loadNFTs();
});

function orderToJsonSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (v && typeof v === "object" && v._hex && typeof v.toString === "function") {
      return v.toString();
    }
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "undefined") return undefined;
    return v;
  }));
}

// ---------------- BUY NFT ----------------
async function buyNFT(nftRecord) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  notify("Alış hazırlanır...");

  const rawOrder = nftRecord.seaport_order || JSON.parse(nftRecord.seaportOrderJSON || "{}");
  if (!rawOrder || Object.keys(rawOrder).length === 0) return alert("Order boşdur!");

  try {
    const buyer = await signer.getAddress();
    notify("Transaction göndərilir...");

    const result = await seaport.fulfillOrder({ order: rawOrder, accountAddress: buyer });
    const txResponse = await (result.executeAllActions ? result.executeAllActions() : (result.execute ? result.execute() : null));
    if (!txResponse) throw new Error("Fulfill execute nəticəsi alınmadı");
    if (txResponse.wait) await txResponse.wait();

    notify("NFT alındı! ✅");

    await fetch(`${BACKEND_URL}/api/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid: nftRecord.tokenid,
        nft_contract: NFT_CONTRACT_ADDRESS,
        marketplace_contract: SEAPORT_CONTRACT_ADDRESS,
        buyer_address: buyer,
        seaport_order: rawOrder,
        order_hash: nftRecord.order_hash || nftRecord.orderHash || rawOrder.orderHash || rawOrder.hash || null,
        on_chain: true,
      }),
    });

    loadedCount = 0;
    allNFTs = [];
    marketplaceDiv.innerHTML = "";
    loadNFTs();
  } catch (err) {
    console.error(err);
    alert("Buy xətası: " + (err?.message || err));
  }
}

// ---------------- LIST NFT ----------------
async function listNFT(tokenid, price, card) {
  if (!signer || !seaport) return alert("Cüzdan qoşulmayıb!");
  const seller = (await signer.getAddress()).toLowerCase();

  const nftContract = new ethers.Contract(
    NFT_CONTRACT_ADDRESS,
    [
      "function ownerOf(uint256) view returns (address)",
      "function isApprovedForAll(address owner, address operator) view returns (bool)",
      "function setApprovalForAll(address operator, bool approved) public",
    ],
    signer
  );

  notify("Sahiblik yoxlanılır...");
  try {
    const owner = (await nftContract.ownerOf(tokenid)).toLowerCase();
    if (owner !== seller) return alert("Bu NFT sənin deyil!");
  } catch (e) {
    console.error("ownerOf err:", e);
    return alert("Sahiblik məlum olmadı (token mövcud deyil və ya RPC xətası).");
  }

  const priceWei = price; // artıq BigNumber
  const approved = await nftContract.isApprovedForAll(seller, SEAPORT_CONTRACT_ADDRESS);
  if (!approved) {
    notify("Approve göndərilir...");
    const tx = await nftContract.setApprovalForAll(SEAPORT_CONTRACT_ADDRESS, true);
    await tx.wait();
  }

  notify("Seaport order yaradılır...");

  const startTime = Math.floor(Date.now() / 1000).toString();
  const endTime = (Math.floor(Date.now() / 1000) + 86400 * 30).toString();

  const createReq = {
    offerer: seller,
    offer: [
      {
        itemType: 2,
        token: NFT_CONTRACT_ADDRESS,
        identifierOrCriteria: tokenid.toString(),
        startAmount: "1",
        endAmount: "1",
      },
    ],
    consideration: [
      {
        itemType: 0,
        token: "0x0000000000000000000000000000000000000000",
        identifierOrCriteria: "0",
        startAmount: priceWei.toString(),
        endAmount: priceWei.toString(),
        recipient: seller,
      },
    ],
    startTime,
    endTime,
    orderType: 0,
    zone: "0x0000000000000000000000000000000000000000",
    conduitKey: "0x0000000000000000000000000000000000000000000000000000000000000000",
    salt: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
  };

  try {
    const orderResult = await seaport.createOrder(createReq);
    const signed = await (orderResult.executeAllActions ? orderResult.executeAllActions() : (orderResult.execute ? orderResult.execute() : orderResult));
    const signedOrder = signed.order ? signed.order : (signed?.signedOrder ? signed.signedOrder : signed);

    const plainOrderJSON = orderToJsonSafe(signedOrder || signed);

    let orderHash = plainOrderJSON.orderHash || plainOrderJSON.hash || plainOrderJSON.orderHashHex || null;
    if (!orderHash) {
      try {
        const jsonStr = JSON.stringify(plainOrderJSON);
        orderHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(jsonStr));
      } catch (e) {
        console.warn("orderHash alınmadı, fallback uğursuz:", e.message);
        orderHash = (Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
      }
    }

    notify("Order backend-ə göndərilir...");
    const res = await fetch(`${BACKEND_URL}/api/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenid,
        price: ethers.utils.formatEther(priceWei), // frontend üçün readable qiymət
        nft_contract: NFT_CONTRACT_ADDRESS,
        marketplace_contract: SEAPORT_CONTRACT_ADDRESS,
        seller_address: seller,
        buyer_address: null,
        seaport_order: plainOrderJSON,
        order_hash: orderHash,
        on_chain: false,
        createdat: new Date().toISOString(),
        updatedat: new Date().toISOString(),
      }),
    });

    const j = await res.json();
    if (!j.success) return alert("Backend order-u qəbul etmədi: " + (j.error || "unknown"));

    card.querySelector(".price").textContent = `Qiymət: ${ethers.utils.formatEther(priceWei)} APE`;
    notify(`NFT #${tokenid} list olundu — ${ethers.utils.formatEther(priceWei)} APE`);

    loadedCount = 0;
    allNFTs = [];
    marketplaceDiv.innerHTML = "";
    loadNFTs();
  } catch (err) {
    console.error("create/list err:", err);
    alert("Listing xətası: " + (err?.message || err));
  }
}

window.buyNFT = buyNFT;
window.listNFT = listNFT;
window.loadNFTs = loadNFTs;
