import { expect } from "chai";
import { BigNumber, constants, Signer, utils } from "ethers";
import { ethers, network } from "hardhat";
import { MerkleTree } from "merkletreejs";
import { MaskToken, MaskToken__factory, TokenClaim, TokenClaim__factory } from "../types";

const ONE_ETH = utils.parseEther("1");

describe("TokenClaim", () => {
  let snapshotId: string;
  let deployer: Signer;
  let signer1: Signer;
  let signer2: Signer;
  let signer3: Signer;
  let deployerAddress: string;
  let signer1Address: string;
  let signer2Address: string;
  let signer3Address: string;

  let tokenClaimContract: TokenClaim;
  let maskToken: MaskToken;

  let airdropList: string[] = [];
  let merkleTree: MerkleTree;
  let merkleRoot: string;

  before(async () => {
    [deployer, signer1, signer2, signer3] = await ethers.getSigners();
    deployerAddress = await deployer.getAddress();
    signer1Address = await signer1.getAddress();
    signer2Address = await signer2.getAddress();
    signer3Address = await signer3.getAddress();
    tokenClaimContract = await new TokenClaim__factory(deployer).deploy();
    maskToken = await new MaskToken__factory(deployer).deploy();
    await maskToken.transfer(tokenClaimContract.address, utils.parseEther("100"));
    expect(await maskToken.balanceOf(tokenClaimContract.address)).to.be.eq(utils.parseEther("100"));

    airdropList.push(utils.keccak256(utils.solidityPack(["address", "uint256"], [signer1Address, ONE_ETH])));
    airdropList.push(utils.keccak256(utils.solidityPack(["address", "uint256"], [signer2Address, ONE_ETH])));
    airdropList.push(utils.keccak256(utils.solidityPack(["address", "uint256"], [signer3Address, ONE_ETH])));
    merkleTree = new MerkleTree(airdropList, utils.keccak256, { sortPairs: true });
    merkleRoot = merkleTree.getHexRoot();
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("Test Owner", async () => {
    expect(await tokenClaimContract.owner()).to.be.eq(deployerAddress);
    await expect(tokenClaimContract.connect(signer1).transferOwnership(signer1Address)).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
    await expect(tokenClaimContract.withdrawToken(maskToken.address, utils.parseEther("101"))).to.be.reverted;
    await tokenClaimContract.withdrawToken(maskToken.address, utils.parseEther("50"));
    expect(await maskToken.balanceOf(tokenClaimContract.address)).to.be.eq(utils.parseEther("50"));
    await tokenClaimContract.withdrawToken(maskToken.address, utils.parseEther("50"));
    expect(await maskToken.balanceOf(tokenClaimContract.address)).to.be.eq(0);
  });

  it("Time check", async () => {
    let leaf = utils.keccak256(utils.solidityPack(["address", "uint256"], [signer1Address, ONE_ETH]));
    let proof = merkleTree.getHexProof(leaf);
    expect(merkleTree.verify(proof, leaf, merkleRoot)).to.be.true;
    let index = await tokenClaimContract.eventIndex();
    expect(index).to.be.eq(BigNumber.from(0));

    await expect(
      tokenClaimContract["setupEvent(address,uint256,uint256,bytes32)"](
        maskToken.address,
        constants.MaxUint256,
        constants.Zero,
        merkleRoot,
      ),
    ).to.be.revertedWith("TokenClaim: Invalid Time");

    await tokenClaimContract["setupEvent(address,uint256,uint256,bytes32)"](
      maskToken.address,
      constants.MaxUint256,
      constants.MaxUint256,
      merkleRoot,
    );
    expect(await tokenClaimContract.eventIndex()).to.be.eq(index.add(1));
    expect(await maskToken.balanceOf(signer1Address)).to.be.eq(BigNumber.from(0));
    await expect(tokenClaimContract.claim(index, proof, signer1Address, ONE_ETH)).to.be.revertedWith(
      "TokenClaim: Have not started!",
    );
  });

  it("Claim Test", async () => {
    let leaf = utils.keccak256(utils.solidityPack(["address", "uint256"], [signer1Address, ONE_ETH]));
    let proof = merkleTree.getHexProof(leaf);
    expect(merkleTree.verify(proof, leaf, merkleRoot)).to.be.true;
    let index = await tokenClaimContract.eventIndex();
    expect(index).to.be.eq(BigNumber.from(0));
    await tokenClaimContract["setupEvent(address,uint256,bytes32)"](
      maskToken.address,
      BigNumber.from(1000),
      merkleRoot,
    );
    expect(await tokenClaimContract.eventIndex()).to.be.eq(index.add(1));
    expect(await maskToken.balanceOf(signer1Address)).to.be.eq(BigNumber.from(0));

    // Fail Case: wrong amount
    await expect(tokenClaimContract.claim(index, proof, signer1Address, 10)).to.be.revertedWith(
      "TokenClaim: Unable to verify",
    );

    // Success
    expect(await tokenClaimContract.isClaimed(index, signer1Address)).to.be.false;
    await tokenClaimContract.claim(index, proof, signer1Address, ONE_ETH);
    expect(await tokenClaimContract.isClaimed(index, signer1Address)).to.be.true;
    expect(await maskToken.balanceOf(signer1Address)).to.be.eq(ONE_ETH);

    // Fail Case: already claimed
    await expect(tokenClaimContract.claim(index, proof, signer1Address, ONE_ETH)).to.be.revertedWith(
      "TokenClaim: Already claimed!",
    );

    leaf = utils.keccak256(utils.solidityPack(["address", "uint256"], [signer2Address, ONE_ETH]));
    proof = merkleTree.getHexProof(leaf);
    expect(merkleTree.verify(proof, leaf, merkleRoot)).to.be.true;
    index = await tokenClaimContract.eventIndex();
    expect(index).to.be.eq(BigNumber.from(1));
    await tokenClaimContract["setupEvent(address,uint256,bytes32)"](
      maskToken.address,
      BigNumber.from(1000),
      merkleRoot,
    );
    expect(await tokenClaimContract.eventIndex()).to.be.eq(index.add(1));
    expect(await maskToken.balanceOf(signer2Address)).to.be.eq(BigNumber.from(0));

    // Fail Case: expired
    await network.provider.send("evm_increaseTime", [1001]);
    await expect(tokenClaimContract.claim(index, proof, signer2Address, ONE_ETH)).to.be.revertedWith(
      "TokenClaim: Expired!",
    );
  });

  it("Update merkle root", async () => {
    let leaf = utils.keccak256(utils.solidityPack(["address", "uint256"], [signer1Address, ONE_ETH]));
    let index = await tokenClaimContract.eventIndex();
    let proof = merkleTree.getHexProof(leaf);

    await tokenClaimContract["setupEvent(address,uint256,bytes32)"](
      maskToken.address,
      BigNumber.from(1000),
      merkleRoot,
    );

    const beforeClaimSnapshot = await network.provider.send("evm_snapshot", []);
    await tokenClaimContract.claim(index, proof, signer1Address, ONE_ETH); // make sure signer1 can claim
    await network.provider.send("evm_revert", [beforeClaimSnapshot]);

    const newList = airdropList.slice(1, 3); // remove signer1 from the list
    let tree = new MerkleTree(newList, utils.keccak256, { sortPairs: true });
    let root = "0x" + tree.getRoot().toString("hex");
    expect(tree.verify(tree.getProof(leaf), leaf, root)).to.be.false;
    await tokenClaimContract.updateMerkleRoot(index, root);
    await expect(tokenClaimContract.claim(index, proof, signer1Address, ONE_ETH)).to.be.revertedWith(
      "TokenClaim: Unable to verify",
    );
  });
});
