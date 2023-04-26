import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  const TokenClaimFactory = await ethers.getContractFactory("TokenClaim");
  const tokenClaim = await TokenClaimFactory.deploy();

  await tokenClaim.deployed();
  console.log("tokenClaim address:", tokenClaim.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
