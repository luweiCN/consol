// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public number;
    address public owner;

    event NumberChanged(uint256 value);

    constructor(uint256 initialNumber) {
        number = initialNumber;
        owner = msg.sender;
    }

    function setNumber(uint256 newNumber) public {
        number = newNumber;
        emit NumberChanged(newNumber);
    }

    function increment() public {
        number++;
        emit NumberChanged(number);
    }
}

