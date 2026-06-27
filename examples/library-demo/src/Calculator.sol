// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {MathLib} from "./MathLib.sol";

contract Calculator {
    function go(uint256 a, uint256 b) external pure returns (uint256) {
        return MathLib.add(a, b);
    }
}
