import { expect } from "chai";
import { BigNumber, constants, Signer, utils } from "ethers";
import { ethers, network } from "hardhat";
import { MerkleTree } from "merkletreejs";
import { MaskToken, MaskToken__factory, TokenClaim, TokenClaim__factory } from "../types";

describe("TokenClaim", () => {
  let snapshotId: string;
  let deployer: Signer;
  let signer1: Signer;
  let signer2: Signer;
  let signer3: Signer;
  let signer1Address: string;
  let signer2Address: string;
  let signer3Address: string;

  let tokenClaimContract: TokenClaim;
  let maskToken: MaskToken;

  let merkleTree: MerkleTree;
  let merkleRoot: string;

  before(async () => {
    [deployer, signer1, signer2, signer3] = await ethers.getSigners();
    signer1Address = await signer1.getAddress();
    signer2Address = await signer2.getAddress();
    signer3Address = await signer3.getAddress();
    tokenClaimContract = await new TokenClaim__factory(deployer).deploy();
    maskToken = await new MaskToken__factory(deployer).deploy();
    await maskToken.transfer(tokenClaimContract.address, utils.parseEther("100"));
    expect(await maskToken.balanceOf(tokenClaimContract.address)).to.be.eq(utils.parseEther("100"));
    let airdropList: string[] = [];
    airdropList.push(
      utils.keccak256(utils.solidityPack(["address", "uint256"], [signer1Address, utils.parseEther("1")])),
    );
    airdropList.push(
      utils.keccak256(utils.solidityPack(["address", "uint256"], [signer2Address, utils.parseEther("1")])),
    );
    airdropList.push(
      utils.keccak256(utils.solidityPack(["address", "uint256"], [signer3Address, utils.parseEther("1")])),
    );
    merkleTree = new MerkleTree(airdropList, utils.keccak256);
    merkleRoot = "0x" + merkleTree.getRoot().toString("hex");
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("Time check", async () => {
    let leaf = utils.keccak256(utils.solidityPack(["address", "uint256"], [signer1Address, utils.parseEther("1")]));
    let proof = merkleTree.getProof(leaf);
    expect(merkleTree.verify(proof, leaf, merkleRoot)).to.be.true;
    let index = await tokenClaimContract.eventIndex();
    expect(index).to.be.eq(BigNumber.from(0));

    await expect(
      tokenClaimContract["setupEvent(address,uint256,uint256,bytes32)"](
        maskToken.address,
        constants.MaxUint256,
        constants.Zero,
        ethers.utils.hexZeroPad(merkleRoot, 32),
      ),
    ).to.be.revertedWith("TokenClaim: Invalid Time");

    await tokenClaimContract["setupEvent(address,uint256,uint256,bytes32)"](
      maskToken.address,
      constants.MaxUint256,
      constants.MaxUint256,
      ethers.utils.hexZeroPad(merkleRoot, 32),
    );
    expect(await tokenClaimContract.eventIndex()).to.be.eq(index.add(1));
    expect(await maskToken.balanceOf(signer1Address)).to.be.eq(BigNumber.from(0));
    await expect(tokenClaimContract.claim(index, merkleTree.getHexProof(leaf), signer1Address, 10)).to.be.revertedWith(
      "TokenClaim: Have not started!",
    );
  });

  it("Claim Test", async () => {
    let leaf = utils.keccak256(utils.solidityPack(["address", "uint256"], [signer1Address, utils.parseEther("1")]));
    let proof = merkleTree.getProof(leaf);
    expect(merkleTree.verify(proof, leaf, merkleRoot)).to.be.true;
    let index = await tokenClaimContract.eventIndex();
    expect(index).to.be.eq(BigNumber.from(0));
    await tokenClaimContract["setupEvent(address,uint256,bytes32)"](
      maskToken.address,
      BigNumber.from(1000),
      ethers.utils.hexZeroPad(merkleRoot, 32),
    );
    expect(await tokenClaimContract.eventIndex()).to.be.eq(index.add(1));
    expect(await maskToken.balanceOf(signer1Address)).to.be.eq(BigNumber.from(0));

    // Fail Case: wrong amount
    await expect(tokenClaimContract.claim(index, merkleTree.getHexProof(leaf), signer1Address, 10)).to.be.revertedWith(
      "TokenClaim: Unable to verify",
    );
    await tokenClaimContract.claim(index, merkleTree.getHexProof(leaf), signer1Address, utils.parseEther("1"));
    expect(await maskToken.balanceOf(signer1Address)).to.be.eq(utils.parseEther("1"));

    // Fail Case: already claimed
    await expect(
      tokenClaimContract.claim(index, merkleTree.getHexProof(leaf), signer1Address, utils.parseEther("1")),
    ).to.be.revertedWith("TokenClaim: Already claimed!");

    leaf = utils.keccak256(utils.solidityPack(["address", "uint256"], [signer2Address, utils.parseEther("1")]));
    proof = merkleTree.getProof(leaf);
    expect(merkleTree.verify(proof, leaf, merkleRoot)).to.be.true;
    index = await tokenClaimContract.eventIndex();
    expect(index).to.be.eq(BigNumber.from(1));
    await tokenClaimContract["setupEvent(address,uint256,bytes32)"](
      maskToken.address,
      BigNumber.from(1000),
      ethers.utils.hexZeroPad(merkleRoot, 32),
    );
    expect(await tokenClaimContract.eventIndex()).to.be.eq(index.add(1));
    expect(await maskToken.balanceOf(signer2Address)).to.be.eq(BigNumber.from(0));

    // Fail Case: expired
    await network.provider.send("evm_increaseTime", [1001]);
    await expect(
      tokenClaimContract.claim(index, merkleTree.getHexProof(leaf), signer2Address, utils.parseEther("1")),
    ).to.be.revertedWith("TokenClaim: Expired!");
  });
});
