import { Ed25519Keypair, JsonRpcProvider, RawSigner } from '@mysten/sui.js';
import bip39 from 'bip39'
import axios from 'axios'
import HttpsProxyAgent from 'https-proxy-agent';
import fs from 'fs';
import consoleStamp from 'console-stamp';

consoleStamp(console, { format: ':date(HH:MM:ss)' });

const timeout = ms => new Promise(res => setTimeout(res, ms))
const provider = new JsonRpcProvider('https://fullnode.testnet.sui.io')

const nftArray = [[
    'Example NFT',
    'An NFT created by Sui Wallet',
    'ipfs://QmZPWWy5Si54R3d26toaqRiqvCH7HkGdXkxwUgCm2oKKM2?filename=img-sq-01.png',
], [
    'Example NFT',
    'An NFT created by the wallet Command Line Tool',
    'ipfs://bafkreibngqhl3gaa7daob4i2vccziay2jjlp435cf66vhono7nrvww53ty',
], [
    'Wizard Land',
    'Expanding The Magic Land',
    'https://gateway.pinata.cloud/ipfs/QmYfw8RbtdjPAF3LrC6S3wGVwWgn6QKq4LGS4HFS55adU2?w=800&h=450&c=crop',
], [
    'Ethos 2048 Game',
    'This player has unlocked the 2048 tile on Ethos 2048. They are a Winner!',
    'https://arweave.net/QW9doLmmWdQ-7t8GZ85HtY8yzutoir8lGEJP9zOPQqA',
], [
    "Sample NFT 1",
    "Sample NFT",
    "https://cdn.martianwallet.xyz/assets/sample-nft.png"
], [
    "Sui Test Ecosystem",
    "Get ready for the Suinami 🌊",
    "ipfs://QmVnWhM2qYr9JkjGLaEVSZnCprRLDW8qns1oYYVXjnb4DA/sui.jpg"
], [
    "Skull Sui",
    "Skulls are emerging from the ground!",
    "https://gateway.pinata.cloud/ipfs/QmcsJtucGrzkup9cZp2N8vvTc9zxuQtV85z3g2Rs4YRLGX"
]]

function parseFile(file) {
    let data = fs.readFileSync(file, "utf8");
    let array = data.split('\n').map(str => str.trim());
    const proxyRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})@(\w+):(\w+)/;
    let proxyLists = [];

    array.forEach(proxy => {
        if (proxy.match(proxyRegex)) {
            proxyLists.push({ "ip": `http://${proxy.split("@")[1]}@${proxy.split("@")[0]}`, "limited": false, "authFailed": false })
        }
    })

    return proxyLists
}

function saveMnemonic(mnemonic) {
    fs.appendFileSync("mnemonic.txt", `${mnemonic}\n`, "utf8");
}

async function checkProxy(proxyList) {
    let checkedProxy = await Promise.all(proxyList.map(async (proxy) => {
        let axiosInstance = axios.create({ httpsAgent: HttpsProxyAgent(proxy.ip) })
        await axiosInstance.get("https://api64.ipify.org/?format=json")
            .catch(err => {
                console.log(`Proxy ${proxy.ip.split("@")[1]} check error: ${err?.response?.statusText}`)
                switch (err?.response?.status) {
                    case 407: proxy.authFailed = true;
                    case 429: proxy.limited = true;
                }
            });
        return proxy
    }))

    return checkedProxy.filter((proxy) => !proxy.limited && !proxy.authFailed);
}

async function requestSuiFromFaucet(proxy, recipient) {
    console.log(`Requesting SUI from faucet with proxy ${proxy.ip.split("@")[1]}`);
    const axiosInstance = axios.create({ httpsAgent: HttpsProxyAgent(proxy.ip) })

    let res = await axiosInstance("https://faucet.testnet.sui.io/gas", {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ FixedAmountRequest: { recipient } }),
        method: "POST"
    }).catch(async err => {
        console.log('Faucet error:', err?.response?.statusText || err.code)

        if (err?.response?.status == 429) {
            proxy.limited = true;
            console.log(`Proxy rate limited, need to wait ${err.response.headers['retry-after']} seconds`);
            await timeout(5000)
        }
    })

    res?.data && console.log(`Faucet request status: ${res?.statusText}`);

    return res?.data
}

async function mintNft(signer, args) {
    console.log(`Minting: ${args[1]}`);

    return await signer.executeMoveCall({
        packageObjectId: '0x2',
        module: 'devnet_nft',
        function: 'mint',
        typeArguments: [],
        arguments: args,
        gasBudget: 10000,
    })
}


(async () => {
    let proxyList = parseFile('proxy.txt');
    console.log(`Found ${proxyList.length} proxies`);
    let validProxy = await checkProxy(proxyList);
    validProxy.length == proxyList.length ? console.log('All proxies are valid') : console.log(`Valid ${validProxy.length}/${proxyList.length} proxies`);

    if (validProxy.length > 0) {
        while (validProxy.every(proxy => !proxy.limited)) {
            for (let i = 0; i < validProxy.length; i++) {
                try {
                    const mnemonic = bip39.generateMnemonic()
                    const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
                    const address = keypair.getPublicKey().toSuiAddress()

                    let response = await requestSuiFromFaucet(validProxy[i], address)

                    if (response) {
                        console.log(`Sui Address: 0x${address}`)
                        console.log(`Mnemonic: ${mnemonic}`);
                        saveMnemonic(mnemonic);
                        const signer = new RawSigner(keypair, provider);

                        for (let i = 0; i < nftArray.length; i++) {
                            await mintNft(signer, nftArray[i])
                        }

                        console.log(`Result: https://explorer.sui.io/addresses/${address}?network=testnet`);
                    }
                } catch (err) {
                    console.log(err.message);
                    await timeout(10000)
                }
                console.log("-".repeat(100));
            }
        }
    } else console.log('No working proxies found, please make sure the proxy is in the correct format');
})()