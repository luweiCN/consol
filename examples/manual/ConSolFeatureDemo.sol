// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IConSolFeatureDemo {
    function summary() external view returns (uint256 counter, bool enabled, uint8 mode, uint256 balance);
}

library DemoMath {
    function clamp(uint256 value, uint256 max) internal pure returns (uint256) {
        return value > max ? max : value;
    }
}

abstract contract DemoOwnable {
    address public owner;

    error NotOwner(address caller);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    constructor() {
        owner = msg.sender;
    }
}

contract ConSolFeatureDemo is DemoOwnable, IConSolFeatureDemo {
    enum Mode {
        Idle,
        Active,
        Paused
    }

    struct Profile {
        string name;
        uint256 score;
        bool verified;
    }

    uint256 public counter;
    string public note;
    bool public enabled;
    Mode public mode;
    address public lastSender;

    uint256[] private scores;
    mapping(address => uint256) public deposits;
    mapping(address => Profile) private profiles;

    event CounterChanged(address indexed actor, uint256 value);
    event DepositReceived(address indexed actor, uint256 amount);
    event ProfileSaved(address indexed actor, string name, uint256 score, bool verified);
    event ModeChanged(Mode mode);

    error EmptyName();
    error InvalidMode(uint8 mode);
    error InsufficientDeposit(uint256 requested, uint256 available);

    constructor(uint256 initialCounter, string memory initialNote) payable {
        counter = initialCounter;
        note = initialNote;
        enabled = true;
        mode = Mode.Active;
        lastSender = msg.sender;
        if (msg.value > 0) {
            deposits[msg.sender] = msg.value;
            emit DepositReceived(msg.sender, msg.value);
        }
    }

    receive() external payable {
        deposits[msg.sender] += msg.value;
        lastSender = msg.sender;
        emit DepositReceived(msg.sender, msg.value);
    }

    function summary() external view returns (uint256 currentCounter, bool currentEnabled, uint8 currentMode, uint256 balance) {
        return (counter, enabled, uint8(mode), address(this).balance);
    }

    function scoreCount() external view returns (uint256) {
        return scores.length;
    }

    function scoreAt(uint256 index) external view returns (uint256) {
        return scores[index];
    }

    function profileOf(address account) external view returns (string memory name, uint256 score, bool verified) {
        Profile storage profile = profiles[account];
        return (profile.name, profile.score, profile.verified);
    }

    function setNote(string calldata nextNote) external onlyOwner {
        note = nextNote;
        lastSender = msg.sender;
    }

    function increment(uint256 amount) external returns (uint256) {
        counter += amount;
        lastSender = msg.sender;
        emit CounterChanged(msg.sender, counter);
        return counter;
    }

    function setMode(uint8 nextMode) external onlyOwner {
        if (nextMode > uint8(Mode.Paused)) {
            revert InvalidMode(nextMode);
        }
        mode = Mode(nextMode);
        emit ModeChanged(mode);
    }

    function pushScore(uint256 score) external {
        scores.push(DemoMath.clamp(score, 10_000));
        lastSender = msg.sender;
    }

    function saveProfile(string calldata name, uint256 score, bool verified) external {
        if (bytes(name).length == 0) {
            revert EmptyName();
        }
        profiles[msg.sender] = Profile({ name: name, score: DemoMath.clamp(score, 10_000), verified: verified });
        lastSender = msg.sender;
        emit ProfileSaved(msg.sender, name, score, verified);
    }

    function deposit() external payable {
        deposits[msg.sender] += msg.value;
        lastSender = msg.sender;
        emit DepositReceived(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        uint256 available = deposits[msg.sender];
        if (amount > available) {
            revert InsufficientDeposit(amount, available);
        }
        deposits[msg.sender] = available - amount;
        lastSender = msg.sender;
        payable(msg.sender).transfer(amount);
    }
}

contract ConSolSimpleCounter {
    uint256 public value;

    event ValueChanged(uint256 value);

    function setValue(uint256 nextValue) external {
        value = nextValue;
        emit ValueChanged(nextValue);
    }

    function doubleValue() external view returns (uint256) {
        return value * 2;
    }
}
