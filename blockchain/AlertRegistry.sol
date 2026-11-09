// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PrediSys AlertRegistry
/// @notice Registro inmutable de alertas críticas. Solo guarda el hash SHA-256 del registro
///         de la bitácora (RDS) y metadatos mínimos; la telemetría completa nunca sube a la cadena.
contract AlertRegistry {
    struct Record {
        bytes32 recordHash;     // SHA-256 del registro canónico de la alerta
        uint64 alertTimestamp;  // momento de la lectura que originó la alerta (epoch s)
        uint64 anchoredAt;      // momento de inclusión en el bloque
        uint16 probabilityBps;  // probabilidad de falla en puntos básicos (0-10000)
        string machineCode;     // ej. "Rig-07"
        address submitter;
    }

    address public owner;
    uint256 public totalRecords;
    mapping(address => bool) public writers;
    mapping(bytes32 => Record) private records;

    event AlertAnchored(bytes32 indexed alertId, bytes32 indexed recordHash, string machineCode, uint16 probabilityBps, uint64 alertTimestamp);
    event WriterUpdated(address indexed writer, bool enabled);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotWriter();
    error AlreadyAnchored(bytes32 alertId);
    error InvalidRecord();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        writers[msg.sender] = true;
        emit WriterUpdated(msg.sender, true);
    }

    function setWriter(address writer, bool enabled) external onlyOwner {
        writers[writer] = enabled;
        emit WriterUpdated(writer, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidRecord();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Registra una alerta. No existe función de actualización ni borrado: una vez anclado, es inmutable.
    function anchor(bytes32 alertId, bytes32 recordHash, string calldata machineCode, uint16 probabilityBps, uint64 alertTimestamp) external {
        if (!writers[msg.sender]) revert NotWriter();
        if (recordHash == bytes32(0) || probabilityBps > 10000 || bytes(machineCode).length == 0 || bytes(machineCode).length > 32) revert InvalidRecord();
        if (records[alertId].anchoredAt != 0) revert AlreadyAnchored(alertId);
        records[alertId] = Record(recordHash, alertTimestamp, uint64(block.timestamp), probabilityBps, machineCode, msg.sender);
        unchecked { totalRecords++; }
        emit AlertAnchored(alertId, recordHash, machineCode, probabilityBps, alertTimestamp);
    }

    function getRecord(bytes32 alertId) external view returns (
        bytes32 recordHash, uint64 alertTimestamp, uint64 anchoredAt, uint16 probabilityBps, string memory machineCode, address submitter
    ) {
        Record storage r = records[alertId];
        return (r.recordHash, r.alertTimestamp, r.anchoredAt, r.probabilityBps, r.machineCode, r.submitter);
    }

    function isAnchored(bytes32 alertId, bytes32 recordHash) external view returns (bool) {
        return records[alertId].anchoredAt != 0 && records[alertId].recordHash == recordHash;
    }
}
