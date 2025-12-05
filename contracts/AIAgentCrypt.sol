pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AIAgentInteractionFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchNotClosed();
    error InvalidCooldown();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(uint256 indexed batchId, address indexed provider, uint256 encryptedValue);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 decryptedValue);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    mapping(address => bool) public isProvider;
    mapping(uint256 => euint32) public encryptedBatchData;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    address public owner;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    bool public batchOpen;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier decryptionRequestCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        cooldownSeconds = 60; // Default 1 minute cooldown
        currentBatchId = 0;
        batchOpen = false;
    }

    function addProvider(address _provider) external onlyOwner {
        if (!isProvider[_provider]) {
            isProvider[_provider] = true;
            emit ProviderAdded(_provider);
        }
    }

    function removeProvider(address _provider) external onlyOwner {
        if (isProvider[_provider]) {
            isProvider[_provider] = false;
            emit ProviderRemoved(_provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        if (_cooldownSeconds == 0) revert InvalidCooldown();
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSet(oldCooldown, _cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchNotClosed();
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchClosed();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedData(euint32 _encryptedValue) external onlyProvider whenNotPaused submissionCooldown {
        if (!batchOpen) revert BatchClosed();
        lastSubmissionTime[msg.sender] = block.timestamp;

        if (!encryptedBatchData[currentBatchId].isInitialized()) {
            encryptedBatchData[currentBatchId] = FHE.asEuint32(0);
        }
        encryptedBatchData[currentBatchId] = encryptedBatchData[currentBatchId].add(_encryptedValue);
        emit DataSubmitted(currentBatchId, msg.sender, _encryptedValue.toBytes32());
    }

    function requestBatchDecryption() external onlyProvider whenNotPaused decryptionRequestCooldown {
        if (batchOpen) revert BatchNotClosed(); // Batch must be closed for decryption
        if (!encryptedBatchData[currentBatchId].isInitialized()) {
            revert("NoDataForBatch"); // Custom error for clarity
        }

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32 memory result = encryptedBatchData[currentBatchId];
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = result.toBytes32();

        bytes32 stateHash = keccak256(abi.encode(cts, address(this)));
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, currentBatchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // Rebuild ciphertexts in the exact same order as in requestBatchDecryption
        euint32 memory result = encryptedBatchData[decryptionContexts[requestId].batchId];
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = result.toBytes32();

        bytes32 currentHash = keccak256(abi.encode(cts, address(this)));
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        uint256 decryptedValue = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, decryptedValue);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage _euint) internal {
        if (!_euint.isInitialized()) {
            _euint = FHE.asEuint32(0);
        }
    }

    function _requireInitialized(euint32 storage _euint) internal view {
        if (!_euint.isInitialized()) {
            revert("NotInitialized");
        }
    }
}