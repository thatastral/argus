// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IArgusFactory {
    function walletOf(address user) external view returns (address);
}
