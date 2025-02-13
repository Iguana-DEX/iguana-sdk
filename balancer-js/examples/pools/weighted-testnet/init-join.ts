import createWeightedPool from './create';
import { Interface, LogDescription } from '@ethersproject/abi';
import { Vault__factory } from '@balancer-labs/typechain';
import WeightedPoolAbi from '@/lib/abi/WeightedPoolNew.json';
import {
  provider,
  wallet,
  network,
  wrappedNativeAsset,
  tokenSymbols,
  addresses,
  tokenAmounts,
} from './example-config';
import { Log, TransactionReceipt } from '@ethersproject/providers';
import { isSameAddress } from '@/lib/utils';
import { ethers } from 'hardhat';
import { BALANCER_NETWORK_CONFIG } from '@/lib/constants/config';
import { AssetHelpers } from '@/lib/utils';
import { WeightedPoolEncoder } from '@/pool-weighted';
import ERC20Abi from '@/lib/abi/ERC20.json';
import { parseFixed } from '@ethersproject/bignumber';

async function initJoinWeightedPool() {
  const poolAddress = await createWeightedPool;
  const walletAddress = await wallet.getAddress();

  const vaultAddress = `${BALANCER_NETWORK_CONFIG[network].addresses.contracts.vault}`;

  console.log('vaultAddress: ' + vaultAddress);

  const poolContract = new ethers.Contract(
    poolAddress,
    WeightedPoolAbi,
    wallet
  );
  const poolId = await poolContract.getPoolId();

  console.log('poolId: ' + poolId);

  const vaultContract = new ethers.Contract(
    vaultAddress,
    Vault__factory.abi,
    wallet
  );

  const tokens = [];
  const tokenAddresses = [];
  const tokenContracts = [];
  const tokenDecimals = [];
  const tokenBalances = [];
  const amountsIn = [];
  let pending: number;

  for (let i = 0; i < tokenSymbols.length; i++) {
    tokens.push(addresses[tokenSymbols[i] as keyof typeof addresses]);

    tokenAddresses.push(tokens[i].address);

    tokenContracts.push(
      new ethers.Contract(tokens[i].address, ERC20Abi, wallet)
    );
    pending = await tokenContracts[i].decimals();
    tokenDecimals.push(pending);

    pending = await tokenContracts[i].balanceOf(walletAddress);
    tokenBalances.push(pending);

    amountsIn.push(parseFixed(tokenAmounts[i], tokenDecimals[i]));

    console.log(
      tokenSymbols[i] +
        ' being deposited: ' +
        tokenAmounts[i] +
        ' / ' +
        tokenBalances[i] / Math.pow(10, tokenDecimals[i])
    );
  }

  const [tokensIn, amountsInF, userData] = formatInputs(
    tokenAddresses,
    amountsIn
  );

  const tx = await vaultContract.joinPool(
    poolId,
    walletAddress, // sender
    walletAddress, // recipient
    {
      // joinPoolRequest
      assets: tokensIn,
      maxAmountsIn: amountsInF,
      userData,
      fromInternalBalance: false,
    },
    {
      gasLimit: 1000000, // 217855
      // gasPrice: ethers.utils.hexlify(ethers.utils.parseUnits('20', 'gwei')),
    }
  );

  console.log('Init join tx hash: ' + tx.hash);

  await tx.wait();

  const receipt: TransactionReceipt = await provider.getTransactionReceipt(
    tx.hash
  );

  const vaultInterface = new Interface(Vault__factory.abi);
  const poolInitJoinEvent: LogDescription | null | undefined = receipt.logs
    .filter((log: Log) => {
      return isSameAddress(log.address, vaultAddress);
    })
    .map((log) => {
      return vaultInterface.parseLog(log);
    })
    .find((parsedLog) => parsedLog?.name === 'PoolBalanceChanged');
  if (!poolInitJoinEvent)
    return console.error("Couldn't find event in the receipt logs");
  const poolTokens = poolInitJoinEvent.args[2];
  const newBalances = poolInitJoinEvent.args[3];
  const oldBalances = poolInitJoinEvent.args[4];
  console.log('Pool Token Addresses: ' + poolTokens);
  console.log('Pool new balances(Big Number): ' + newBalances);
  console.log('Pool old balances: ' + oldBalances);
}

initJoinWeightedPool().then((r) => r);

function formatInputs(tokensIn: any, amountsIn: any) {
  const assetHelpers = new AssetHelpers(wrappedNativeAsset);

  const [sortedTokens, sortedAmounts] = assetHelpers.sortTokens(
    tokensIn,
    amountsIn
  ) as [string[], string[]];

  const userData = WeightedPoolEncoder.joinInit(sortedAmounts);

  return [sortedTokens, sortedAmounts, userData];
}
