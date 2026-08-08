// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TapTab
/// @notice Coordinates exact native-MON funding for a shared bill.
/// @dev Item splitting and all rounding are deterministic. Payments, refunds,
///      and payee proceeds use pull accounting; no external call occurs during
///      funding or settlement.
contract TapTab {
    uint256 public constant MAX_PARTICIPANTS = 32;
    uint256 public constant MAX_ITEMS = 32;
    uint256 public constant MAX_SHARES_PER_ITEM = 32;
    uint256 public constant MAX_TOTAL_SHARES = 128;
    uint256 public constant MAX_METADATA_URI_BYTES = 64_000;
    uint16 public constant MAX_TIP_BPS = 3_000;
    uint16 private constant BPS_DENOMINATOR = 10_000;

    enum BillState {
        None,
        Draft,
        Funding,
        Settled,
        Cancelled,
        Expired
    }

    struct Bill {
        address creator;
        address payable payee;
        string metadataURI;
        uint64 createdAt;
        uint64 deadline;
        uint32 participantCount;
        uint32 approvalCount;
        uint64 splitVersion;
        uint16 lockedTipBps;
        BillState state;
        bool proceedsWithdrawn;
        uint64 cachedSplitDigestVersion;
        uint256 subtotal;
        uint256 totalDue;
        uint256 totalFunded;
        bytes32 receiptDigest;
        bytes32 cachedSplitDigest;
    }

    struct Item {
        uint256 amount;
        uint32 shareCount;
        uint32 claimedShareCount;
    }

    struct Participant {
        bool joined;
        bool fairRemainder;
        uint16 tipVoteBps;
        uint256 baseDue;
        uint256 tipDue;
        uint256 amountDue;
        uint256 amountFunded;
    }

    struct BillView {
        uint256 id;
        address creator;
        address payee;
        string metadataURI;
        uint64 createdAt;
        uint64 deadline;
        uint32 participantCount;
        uint16 lockedTipBps;
        BillState state;
        bool proceedsWithdrawn;
        uint256 subtotal;
        uint256 totalDue;
        uint256 totalFunded;
        uint256 remainingToFund;
    }

    struct SplitStatus {
        bytes32 receiptDigest;
        bytes32 currentDigest;
        uint64 splitVersion;
        uint32 approvalCount;
        uint32 requiredApprovals;
    }

    error BillNotFound();
    error InvalidPayee();
    error InvalidDeadline();
    error InvalidItemConfiguration();
    error MetadataURITooLong(uint256 length, uint256 maximum);
    error InvalidBatchConfiguration();
    error InvalidTipVote();
    error WrongState(BillState expected, BillState actual);
    error DraftClosed();
    error DeadlineNotReached();
    error NotCreator();
    error NotPayee();
    error AlreadyJoined();
    error AlreadyInvited();
    error AlreadyParticipated();
    error NotInvited();
    error NotParticipant();
    error InvalidParticipant();
    error ParticipantLimitReached();
    error InvalidTransferRecipient();
    error ClaimedSharesRequireRecipient();
    error NoSplitChange();
    error SplitDigestMismatch(bytes32 expected, bytes32 actual);
    error SplitAlreadyApproved();
    error SplitNotUnanimouslyApproved(uint256 approved, uint256 required);
    error InvalidShare();
    error ShareAlreadyClaimed();
    error NotShareOwner();
    error NoParticipants();
    error UnclaimedValueWithoutOptIn();
    error InvalidBeneficiary();
    error ZeroPayment();
    error PaymentExceedsRemaining(uint256 remaining, uint256 received);
    error BillNotFullyFunded(uint256 funded, uint256 due);
    error BillAlreadyFullyFunded();
    error NoRefundAvailable();
    error NoProceedsAvailable();
    error TransferFailed();
    error Reentrancy();

    event BillCreated(
        uint256 indexed billId,
        address indexed creator,
        address indexed payee,
        uint64 deadline,
        uint256 subtotal,
        string metadataURI
    );
    event ParticipantJoined(
        uint256 indexed billId,
        address indexed participant,
        bool fairRemainder,
        uint16 tipVoteBps
    );
    event ParticipantInvited(uint256 indexed billId, address indexed participant);
    event SplitVersionAdvanced(uint256 indexed billId, uint64 splitVersion);
    event SplitApproved(
        uint256 indexed billId,
        address indexed participant,
        uint64 splitVersion,
        bytes32 splitDigest
    );
    event SplitApprovalRevoked(
        uint256 indexed billId,
        address indexed participant,
        uint64 splitVersion
    );
    event ItemShareTransferred(
        uint256 indexed billId,
        uint256 indexed itemIndex,
        uint256 indexed shareIndex,
        address from,
        address to,
        uint256 shareValue
    );
    event ParticipantLeft(
        uint256 indexed billId,
        address indexed participant,
        address indexed transferRecipient,
        uint256 transferredShareCount
    );
    event PreferencesUpdated(
        uint256 indexed billId,
        address indexed participant,
        bool fairRemainder,
        uint16 tipVoteBps
    );
    event ItemShareClaimed(
        uint256 indexed billId,
        uint256 indexed itemIndex,
        uint256 indexed shareIndex,
        address participant,
        uint256 shareValue
    );
    event ItemShareUnclaimed(
        uint256 indexed billId,
        uint256 indexed itemIndex,
        uint256 indexed shareIndex,
        address participant,
        uint256 shareValue
    );
    event ParticipantDueLocked(
        uint256 indexed billId,
        address indexed participant,
        uint256 amountDue
    );
    event FundingOpened(
        uint256 indexed billId,
        uint16 lockedTipBps,
        uint256 subtotal,
        uint256 tipAmount,
        uint256 totalDue
    );
    event ContributionReceived(
        uint256 indexed billId,
        address indexed payer,
        address indexed beneficiary,
        uint256 amount,
        uint256 beneficiaryFunded,
        uint256 totalFunded
    );
    event BillSettled(uint256 indexed billId, uint256 totalFunded);
    event BillCancelled(uint256 indexed billId, address indexed creator);
    event BillExpired(uint256 indexed billId, address indexed caller);
    event RefundClaimed(uint256 indexed billId, address indexed contributor, uint256 amount);
    event ProceedsWithdrawn(uint256 indexed billId, address indexed payee, uint256 amount);

    uint256 public billCount;

    mapping(uint256 billId => Bill bill) private _bills;
    mapping(uint256 billId => Item[] items) private _items;
    mapping(uint256 billId => address[] participants) private _participants;
    mapping(uint256 billId => mapping(address account => Participant participant))
        private _participant;
    mapping(uint256 billId => mapping(address account => bool invited)) private _invited;
    mapping(uint256 billId => mapping(address account => bool participated))
        private _hasParticipated;
    mapping(uint256 billId => mapping(address account => uint64 version))
        private _approvalVersion;
    mapping(
        uint256 billId => mapping(uint256 itemIndex => mapping(uint256 shareIndex => address owner))
    ) private _shareOwner;
    mapping(uint256 billId => mapping(address contributor => uint256 amount))
        private _contributions;

    uint256 private _unlocked = 1;

    modifier nonReentrant() {
        if (_unlocked != 1) revert Reentrancy();
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    /// @notice Creates a draft bill. Item amounts are denominated in native MON wei.
    function createBill(
        address payable payee,
        string calldata metadataURI,
        uint64 deadline,
        uint256[] calldata itemAmounts,
        uint32[] calldata shareCounts
    ) external returns (uint256 billId) {
        if (payee == address(0) || payee == address(this)) revert InvalidPayee();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (bytes(metadataURI).length > MAX_METADATA_URI_BYTES) {
            revert MetadataURITooLong(bytes(metadataURI).length, MAX_METADATA_URI_BYTES);
        }

        uint256 subtotal = _validatedSubtotal(itemAmounts, shareCounts);

        billId = ++billCount;
        Bill storage bill = _bills[billId];
        bill.creator = msg.sender;
        bill.payee = payee;
        bill.metadataURI = metadataURI;
        bill.createdAt = uint64(block.timestamp);
        bill.deadline = deadline;
        bill.state = BillState.Draft;
        bill.subtotal = subtotal;
        bill.splitVersion = 1;
        bill.receiptDigest = keccak256(
            abi.encode(
                address(this),
                block.chainid,
                billId,
                msg.sender,
                payee,
                keccak256(bytes(metadataURI)),
                deadline,
                itemAmounts,
                shareCounts
            )
        );

        _storeItems(billId, itemAmounts, shareCounts);

        emit BillCreated(billId, msg.sender, payee, deadline, subtotal, metadataURI);
    }

    /// @notice Invites one wallet to join. Only the creator curates participants.
    function inviteParticipant(uint256 billId, address participant) external {
        Bill storage bill = _draftOrRevert(billId);
        if (msg.sender != bill.creator) revert NotCreator();
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (_participants[billId].length == MAX_PARTICIPANTS) {
            revert ParticipantLimitReached();
        }

        _inviteParticipant(billId, participant);
    }

    /// @notice Atomically invites a bounded group of wallets in one transaction.
    function inviteMany(uint256 billId, address[] calldata participants) external {
        Bill storage bill = _draftOrRevert(billId);
        if (msg.sender != bill.creator) revert NotCreator();
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        uint256 participantLength = participants.length;
        if (participantLength == 0 || participantLength > MAX_PARTICIPANTS) {
            revert InvalidBatchConfiguration();
        }
        if (_participants[billId].length == MAX_PARTICIPANTS) {
            revert ParticipantLimitReached();
        }

        for (uint256 i; i < participantLength; ++i) {
            _inviteParticipant(billId, participants[i]);
        }
    }

    /// @notice Consumes a creator invitation and records the participant's preferences.
    function joinBill(uint256 billId, bool fairRemainder, uint16 tipVoteBps) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (tipVoteBps > MAX_TIP_BPS) revert InvalidTipVote();

        Participant storage participant = _participant[billId][msg.sender];
        if (participant.joined) revert AlreadyJoined();
        if (!_invited[billId][msg.sender]) revert NotInvited();
        if (_participants[billId].length == MAX_PARTICIPANTS) {
            revert ParticipantLimitReached();
        }

        delete _invited[billId][msg.sender];
        participant.joined = true;
        participant.fairRemainder = fairRemainder;
        participant.tipVoteBps = tipVoteBps;
        _hasParticipated[billId][msg.sender] = true;
        _participants[billId].push(msg.sender);
        ++bill.participantCount;
        _advanceSplitVersion(billId, bill);

        emit ParticipantJoined(billId, msg.sender, fairRemainder, tipVoteBps);
    }

    /// @notice Changes a participant's preferences while the bill remains Draft.
    function updatePreferences(
        uint256 billId,
        bool fairRemainder,
        uint16 tipVoteBps
    ) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (tipVoteBps > MAX_TIP_BPS) revert InvalidTipVote();

        Participant storage participant = _participant[billId][msg.sender];
        if (!participant.joined) revert NotParticipant();
        if (
            participant.fairRemainder == fairRemainder &&
            participant.tipVoteBps == tipVoteBps
        ) revert NoSplitChange();
        participant.fairRemainder = fairRemainder;
        participant.tipVoteBps = tipVoteBps;
        _advanceSplitVersion(billId, bill);

        emit PreferencesUpdated(billId, msg.sender, fairRemainder, tipVoteBps);
    }

    /// @notice Claims one deterministic share slot of an item.
    function claimItemShare(uint256 billId, uint256 itemIndex, uint256 shareIndex) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (!_participant[billId][msg.sender].joined) revert NotParticipant();

        _claimItemShare(billId, itemIndex, shareIndex, msg.sender);
        _advanceSplitVersion(billId, bill);
    }

    /// @notice Atomically claims a bounded set of share slots in one transaction.
    /// @dev A successful batch advances the split version once, invalidating approvals in O(1).
    function claimMany(
        uint256 billId,
        uint256[] calldata itemIndexes,
        uint256[] calldata shareIndexes
    ) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (!_participant[billId][msg.sender].joined) revert NotParticipant();

        uint256 claimLength = itemIndexes.length;
        if (
            claimLength == 0 ||
            claimLength != shareIndexes.length ||
            claimLength > MAX_TOTAL_SHARES
        ) revert InvalidBatchConfiguration();

        for (uint256 i; i < claimLength; ++i) {
            _claimItemShare(billId, itemIndexes[i], shareIndexes[i], msg.sender);
        }
        _advanceSplitVersion(billId, bill);
    }

    /// @notice Releases one of the caller's claimed item share slots during Draft.
    function unclaimItemShare(uint256 billId, uint256 itemIndex, uint256 shareIndex) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();

        Item storage item = _itemOrRevert(billId, itemIndex);
        if (shareIndex >= item.shareCount) revert InvalidShare();
        if (_shareOwner[billId][itemIndex][shareIndex] != msg.sender) {
            revert NotShareOwner();
        }

        delete _shareOwner[billId][itemIndex][shareIndex];
        --item.claimedShareCount;
        _advanceSplitVersion(billId, bill);
        emit ItemShareUnclaimed(
            billId,
            itemIndex,
            shareIndex,
            msg.sender,
            _shareValue(item, shareIndex)
        );
    }

    /// @notice Approves the exact current receipt, participants, preferences, and claims.
    function approveSplit(uint256 billId, bytes32 expectedDigest) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (!_participant[billId][msg.sender].joined) revert NotParticipant();

        bool cacheHit = bill.cachedSplitDigestVersion == bill.splitVersion;
        bytes32 actualDigest = cacheHit
            ? bill.cachedSplitDigest
            : currentSplitDigest(billId);
        if (expectedDigest != actualDigest) {
            revert SplitDigestMismatch(expectedDigest, actualDigest);
        }
        if (_approvalVersion[billId][msg.sender] == bill.splitVersion) {
            revert SplitAlreadyApproved();
        }
        if (!cacheHit) {
            bill.cachedSplitDigestVersion = bill.splitVersion;
            bill.cachedSplitDigest = actualDigest;
        }
        _approvalVersion[billId][msg.sender] = bill.splitVersion;
        ++bill.approvalCount;
        emit SplitApproved(billId, msg.sender, bill.splitVersion, actualDigest);
    }

    /// @notice Revokes the caller's current-version approval without changing the split.
    function revokeSplitApproval(uint256 billId) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (!_participant[billId][msg.sender].joined) revert NotParticipant();
        if (_approvalVersion[billId][msg.sender] != bill.splitVersion) {
            revert SplitNotUnanimouslyApproved(bill.approvalCount, bill.participantCount);
        }
        _approvalVersion[billId][msg.sender] = 0;
        --bill.approvalCount;
        emit SplitApprovalRevoked(billId, msg.sender, bill.splitVersion);
    }

    /// @notice Transfers all claims to another active diner and removes the caller.
    /// @param transferRecipient May be zero only when the caller owns no share slots.
    function leaveBill(uint256 billId, address transferRecipient) external {
        Bill storage bill = _draftOrRevert(billId);
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (!_participant[billId][msg.sender].joined) revert NotParticipant();
        if (transferRecipient == msg.sender) revert InvalidTransferRecipient();
        if (
            transferRecipient != address(0) &&
            !_participant[billId][transferRecipient].joined
        ) revert InvalidTransferRecipient();

        uint256 transferredShareCount;
        Item[] storage items = _items[billId];
        for (uint256 itemIndex; itemIndex < items.length; ++itemIndex) {
            for (uint256 shareIndex; shareIndex < items[itemIndex].shareCount; ++shareIndex) {
                if (_shareOwner[billId][itemIndex][shareIndex] == msg.sender) {
                    ++transferredShareCount;
                }
            }
        }
        if (transferredShareCount != 0 && transferRecipient == address(0)) {
            revert ClaimedSharesRequireRecipient();
        }

        if (transferredShareCount != 0) {
            for (uint256 itemIndex; itemIndex < items.length; ++itemIndex) {
                Item storage item = items[itemIndex];
                for (uint256 shareIndex; shareIndex < item.shareCount; ++shareIndex) {
                    if (_shareOwner[billId][itemIndex][shareIndex] != msg.sender) continue;
                    _shareOwner[billId][itemIndex][shareIndex] = transferRecipient;
                    emit ItemShareTransferred(
                        billId,
                        itemIndex,
                        shareIndex,
                        msg.sender,
                        transferRecipient,
                        _shareValue(item, shareIndex)
                    );
                }
            }
        }

        Participant storage participant = _participant[billId][msg.sender];
        participant.joined = false;
        participant.fairRemainder = false;
        participant.tipVoteBps = 0;
        participant.baseDue = 0;
        participant.tipDue = 0;
        participant.amountDue = 0;
        participant.amountFunded = 0;
        --bill.participantCount;
        _advanceSplitVersion(billId, bill);
        emit ParticipantLeft(billId, msg.sender, transferRecipient, transferredShareCount);
    }

    /// @notice Locks claims, the median tip vote, and every participant's exact due amount.
    /// @dev For an even participant count, the median is the floor of the two middle
    ///      votes' arithmetic mean. Any rounding dust is assigned in join order.
    function openFunding(uint256 billId) external {
        Bill storage bill = _draftOrRevert(billId);
        if (msg.sender != bill.creator) revert NotCreator();
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        if (bill.participantCount == 0) revert NoParticipants();
        if (bill.approvalCount != bill.participantCount) {
            revert SplitNotUnanimouslyApproved(bill.approvalCount, bill.participantCount);
        }

        address[] storage approvals = _participants[billId];
        for (uint256 i; i < approvals.length; ++i) {
            address account = approvals[i];
            if (!_participant[billId][account].joined) continue;
            if (_approvalVersion[billId][account] != bill.splitVersion) {
                revert SplitNotUnanimouslyApproved(bill.approvalCount, bill.participantCount);
            }
        }

        uint16 lockedTipBps = _lockedMedianVote(billId);
        (uint256 unclaimedValue, uint256 optInCount) = _allocateClaimedShares(billId);

        if (unclaimedValue != 0) {
            if (optInCount == 0) revert UnclaimedValueWithoutOptIn();
            _allocateFairRemainder(billId, unclaimedValue, optInCount);
        }

        uint256 totalTip = (bill.subtotal * lockedTipBps) / BPS_DENOMINATOR;
        _allocateTip(billId, lockedTipBps, totalTip);

        bill.lockedTipBps = lockedTipBps;
        bill.totalDue = bill.subtotal + totalTip;
        bill.state = BillState.Funding;

        address[] storage participantAddresses = _participants[billId];
        for (uint256 i; i < participantAddresses.length; ++i) {
            address account = participantAddresses[i];
            if (!_participant[billId][account].joined) continue;
            emit ParticipantDueLocked(billId, account, _participant[billId][account].amountDue);
        }
        emit FundingOpened(billId, lockedTipBps, bill.subtotal, totalTip, bill.totalDue);
    }

    /// @notice Pays any joined participant's remaining amount, enabling sponsorship.
    function fundParticipant(uint256 billId, address beneficiary) external payable {
        Bill storage bill = _billOrRevert(billId);
        if (bill.state != BillState.Funding) {
            revert WrongState(BillState.Funding, bill.state);
        }
        if (block.timestamp >= bill.deadline) revert DraftClosed();
        Participant storage participant = _participant[billId][beneficiary];
        if (!participant.joined) revert InvalidBeneficiary();
        if (msg.value == 0) revert ZeroPayment();

        uint256 remaining = participant.amountDue - participant.amountFunded;
        if (msg.value > remaining) revert PaymentExceedsRemaining(remaining, msg.value);

        participant.amountFunded += msg.value;
        _contributions[billId][msg.sender] += msg.value;
        bill.totalFunded += msg.value;

        emit ContributionReceived(
            billId,
            msg.sender,
            beneficiary,
            msg.value,
            participant.amountFunded,
            bill.totalFunded
        );
    }

    /// @notice Settles only after every exact due amount has been funded.
    function settleBill(uint256 billId) external {
        Bill storage bill = _billOrRevert(billId);
        if (bill.state != BillState.Funding) {
            revert WrongState(BillState.Funding, bill.state);
        }
        if (bill.totalFunded != bill.totalDue) {
            revert BillNotFullyFunded(bill.totalFunded, bill.totalDue);
        }

        bill.state = BillState.Settled;
        emit BillSettled(billId, bill.totalFunded);
    }

    /// @notice Cancels a Draft or Funding bill; all contributions become refundable.
    function cancelBill(uint256 billId) external {
        Bill storage bill = _billOrRevert(billId);
        if (msg.sender != bill.creator) revert NotCreator();
        if (bill.state != BillState.Draft && bill.state != BillState.Funding) {
            revert WrongState(BillState.Funding, bill.state);
        }
        if (bill.state == BillState.Funding && bill.totalFunded == bill.totalDue) {
            revert BillAlreadyFullyFunded();
        }

        bill.state = BillState.Cancelled;
        emit BillCancelled(billId, msg.sender);
    }

    /// @notice Marks a Draft or Funding bill expired once its deadline passes.
    function expireBill(uint256 billId) external {
        Bill storage bill = _billOrRevert(billId);
        if (bill.state != BillState.Draft && bill.state != BillState.Funding) {
            revert WrongState(BillState.Funding, bill.state);
        }
        if (block.timestamp < bill.deadline) revert DeadlineNotReached();
        if (bill.state == BillState.Funding && bill.totalFunded == bill.totalDue) {
            revert BillAlreadyFullyFunded();
        }

        bill.state = BillState.Expired;
        emit BillExpired(billId, msg.sender);
    }

    /// @notice Pulls all of the caller's contributions after cancellation or expiry.
    function claimRefund(uint256 billId) external nonReentrant {
        Bill storage bill = _billOrRevert(billId);
        if (bill.state != BillState.Cancelled && bill.state != BillState.Expired) {
            revert NoRefundAvailable();
        }

        uint256 amount = _contributions[billId][msg.sender];
        if (amount == 0) revert NoRefundAvailable();
        _contributions[billId][msg.sender] = 0;

        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit RefundClaimed(billId, msg.sender, amount);
    }

    /// @notice Lets only the payee pull the fully settled proceeds.
    function withdrawProceeds(uint256 billId) external nonReentrant {
        Bill storage bill = _billOrRevert(billId);
        if (msg.sender != bill.payee) revert NotPayee();
        if (bill.state != BillState.Settled || bill.proceedsWithdrawn) {
            revert NoProceedsAvailable();
        }

        uint256 amount = bill.totalFunded;
        bill.proceedsWithdrawn = true;
        (bool sent, ) = bill.payee.call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit ProceedsWithdrawn(billId, msg.sender, amount);
    }

    function getBill(uint256 billId) external view returns (BillView memory view_) {
        Bill storage bill = _billOrRevert(billId);
        view_ = BillView({
            id: billId,
            creator: bill.creator,
            payee: bill.payee,
            metadataURI: bill.metadataURI,
            createdAt: bill.createdAt,
            deadline: bill.deadline,
            participantCount: bill.participantCount,
            lockedTipBps: bill.lockedTipBps,
            state: bill.state,
            proceedsWithdrawn: bill.proceedsWithdrawn,
            subtotal: bill.subtotal,
            totalDue: bill.totalDue,
            totalFunded: bill.totalFunded,
            remainingToFund: bill.totalDue - bill.totalFunded
        });
    }

    function getItems(uint256 billId) external view returns (Item[] memory) {
        _billOrRevert(billId);
        return _items[billId];
    }

    function getParticipants(uint256 billId) external view returns (address[] memory) {
        Bill storage bill = _billOrRevert(billId);
        address[] memory active = new address[](bill.participantCount);
        address[] storage history = _participants[billId];
        uint256 activeIndex;
        for (uint256 i; i < history.length; ++i) {
            if (!_participant[billId][history[i]].joined) continue;
            active[activeIndex++] = history[i];
        }
        return active;
    }

    function getParticipant(
        uint256 billId,
        address account
    ) external view returns (Participant memory) {
        _billOrRevert(billId);
        return _participant[billId][account];
    }

    function isInvited(uint256 billId, address account) external view returns (bool) {
        _billOrRevert(billId);
        return _invited[billId][account];
    }

    function getSplitStatus(uint256 billId) external view returns (SplitStatus memory status) {
        Bill storage bill = _billOrRevert(billId);
        status = SplitStatus({
            receiptDigest: bill.receiptDigest,
            currentDigest: currentSplitDigest(billId),
            splitVersion: bill.splitVersion,
            approvalCount: bill.approvalCount,
            requiredApprovals: bill.participantCount
        });
    }

    function hasApprovedCurrentSplit(uint256 billId, address account) external view returns (bool) {
        Bill storage bill = _billOrRevert(billId);
        return
            _participant[billId][account].joined &&
            _approvalVersion[billId][account] == bill.splitVersion;
    }

    /// @notice Domain-separated digest of all immutable receipt and mutable split data.
    function currentSplitDigest(uint256 billId) public view returns (bytes32 digest) {
        Bill storage bill = _billOrRevert(billId);
        digest = keccak256(
            abi.encode(
                "TapTab split approval v1",
                address(this),
                block.chainid,
                billId,
                bill.receiptDigest,
                bill.splitVersion,
                bill.participantCount
            )
        );

        address[] storage participants = _participants[billId];
        for (uint256 i; i < participants.length; ++i) {
            address account = participants[i];
            Participant storage participant = _participant[billId][account];
            if (!participant.joined) continue;
            digest = keccak256(
                abi.encode(
                    digest,
                    account,
                    participant.fairRemainder,
                    participant.tipVoteBps
                )
            );
        }

        Item[] storage items = _items[billId];
        for (uint256 itemIndex; itemIndex < items.length; ++itemIndex) {
            Item storage item = items[itemIndex];
            digest = keccak256(abi.encode(digest, itemIndex, item.amount, item.shareCount));
            for (uint256 shareIndex; shareIndex < item.shareCount; ++shareIndex) {
                digest = keccak256(
                    abi.encode(
                        digest,
                        itemIndex,
                        shareIndex,
                        _shareOwner[billId][itemIndex][shareIndex]
                    )
                );
            }
        }
    }

    function getItemShareOwners(
        uint256 billId,
        uint256 itemIndex
    ) external view returns (address[] memory owners) {
        Item storage item = _itemOrRevert(billId, itemIndex);
        owners = new address[](item.shareCount);
        for (uint256 i; i < item.shareCount; ++i) {
            owners[i] = _shareOwner[billId][itemIndex][i];
        }
    }

    function itemShareValue(
        uint256 billId,
        uint256 itemIndex,
        uint256 shareIndex
    ) external view returns (uint256) {
        Item storage item = _itemOrRevert(billId, itemIndex);
        if (shareIndex >= item.shareCount) revert InvalidShare();
        return _shareValue(item, shareIndex);
    }

    function remainingDue(uint256 billId, address beneficiary) external view returns (uint256) {
        _billOrRevert(billId);
        Participant storage participant = _participant[billId][beneficiary];
        if (!participant.joined) return 0;
        return participant.amountDue - participant.amountFunded;
    }

    function contributionOf(uint256 billId, address contributor) external view returns (uint256) {
        _billOrRevert(billId);
        return _contributions[billId][contributor];
    }

    function claimableRefund(uint256 billId, address contributor) external view returns (uint256) {
        Bill storage bill = _billOrRevert(billId);
        if (bill.state != BillState.Cancelled && bill.state != BillState.Expired) return 0;
        return _contributions[billId][contributor];
    }

    function proceedsAvailable(uint256 billId) external view returns (uint256) {
        Bill storage bill = _billOrRevert(billId);
        if (bill.state != BillState.Settled || bill.proceedsWithdrawn) return 0;
        return bill.totalFunded;
    }

    function _billOrRevert(uint256 billId) private view returns (Bill storage bill) {
        bill = _bills[billId];
        if (bill.state == BillState.None) revert BillNotFound();
    }

    function _inviteParticipant(uint256 billId, address participant) private {
        if (participant == address(0)) revert InvalidParticipant();
        if (_participant[billId][participant].joined) revert AlreadyJoined();
        if (_hasParticipated[billId][participant]) revert AlreadyParticipated();
        if (_invited[billId][participant]) revert AlreadyInvited();

        _invited[billId][participant] = true;
        emit ParticipantInvited(billId, participant);
    }

    function _claimItemShare(
        uint256 billId,
        uint256 itemIndex,
        uint256 shareIndex,
        address participant
    ) private {
        Item storage item = _itemOrRevert(billId, itemIndex);
        if (shareIndex >= item.shareCount) revert InvalidShare();
        if (_shareOwner[billId][itemIndex][shareIndex] != address(0)) {
            revert ShareAlreadyClaimed();
        }

        _shareOwner[billId][itemIndex][shareIndex] = participant;
        ++item.claimedShareCount;
        emit ItemShareClaimed(
            billId,
            itemIndex,
            shareIndex,
            participant,
            _shareValue(item, shareIndex)
        );
    }

    function _advanceSplitVersion(uint256 billId, Bill storage bill) private {
        ++bill.splitVersion;
        bill.approvalCount = 0;
        emit SplitVersionAdvanced(billId, bill.splitVersion);
    }

    function _validatedSubtotal(
        uint256[] calldata itemAmounts,
        uint32[] calldata shareCounts
    ) private pure returns (uint256 subtotal) {
        uint256 itemCount = itemAmounts.length;
        if (itemCount == 0 || itemCount > MAX_ITEMS || itemCount != shareCounts.length) {
            revert InvalidItemConfiguration();
        }

        uint256 totalShares;
        for (uint256 i; i < itemCount; ++i) {
            uint256 shares = shareCounts[i];
            if (
                itemAmounts[i] == 0 ||
                shares == 0 ||
                shares > MAX_SHARES_PER_ITEM ||
                shares > itemAmounts[i]
            ) revert InvalidItemConfiguration();
            subtotal += itemAmounts[i];
            totalShares += shares;
        }
        if (totalShares > MAX_TOTAL_SHARES) revert InvalidItemConfiguration();
    }

    function _storeItems(
        uint256 billId,
        uint256[] calldata itemAmounts,
        uint32[] calldata shareCounts
    ) private {
        for (uint256 i; i < itemAmounts.length; ++i) {
            _items[billId].push(
                Item({amount: itemAmounts[i], shareCount: shareCounts[i], claimedShareCount: 0})
            );
        }
    }

    function _draftOrRevert(uint256 billId) private view returns (Bill storage bill) {
        bill = _billOrRevert(billId);
        if (bill.state != BillState.Draft) revert WrongState(BillState.Draft, bill.state);
    }

    function _itemOrRevert(
        uint256 billId,
        uint256 itemIndex
    ) private view returns (Item storage item) {
        _billOrRevert(billId);
        if (itemIndex >= _items[billId].length) revert InvalidShare();
        item = _items[billId][itemIndex];
    }

    /// @dev Any indivisible item wei goes to the earliest share slots.
    function _shareValue(Item storage item, uint256 shareIndex) private view returns (uint256) {
        uint256 equalShare = item.amount / item.shareCount;
        return equalShare + (shareIndex < item.amount % item.shareCount ? 1 : 0);
    }

    function _lockedMedianVote(uint256 billId) private view returns (uint16) {
        address[] storage participantAddresses = _participants[billId];
        uint16[] memory votes = new uint16[](_bills[billId].participantCount);
        uint256 voteIndex;
        for (uint256 i; i < participantAddresses.length; ++i) {
            Participant storage participant = _participant[billId][participantAddresses[i]];
            if (!participant.joined) continue;
            votes[voteIndex++] = participant.tipVoteBps;
        }
        return _median(votes);
    }

    function _allocateClaimedShares(
        uint256 billId
    ) private returns (uint256 unclaimedValue, uint256 optInCount) {
        address[] storage participantAddresses = _participants[billId];
        for (uint256 i; i < participantAddresses.length; ++i) {
            Participant storage participant = _participant[billId][participantAddresses[i]];
            if (participant.joined && participant.fairRemainder) ++optInCount;
        }

        Item[] storage items = _items[billId];
        for (uint256 itemIndex; itemIndex < items.length; ++itemIndex) {
            Item storage item = items[itemIndex];
            for (uint256 shareIndex; shareIndex < item.shareCount; ++shareIndex) {
                uint256 value = _shareValue(item, shareIndex);
                address owner = _shareOwner[billId][itemIndex][shareIndex];
                if (owner == address(0)) {
                    unclaimedValue += value;
                } else {
                    _participant[billId][owner].baseDue += value;
                }
            }
        }
    }

    function _allocateFairRemainder(
        uint256 billId,
        uint256 unclaimedValue,
        uint256 optInCount
    ) private {
        uint256 equalShare = unclaimedValue / optInCount;
        uint256 remainder = unclaimedValue % optInCount;
        address[] storage participantAddresses = _participants[billId];
        for (uint256 i; i < participantAddresses.length; ++i) {
            Participant storage participant = _participant[billId][participantAddresses[i]];
            if (!participant.joined || !participant.fairRemainder) continue;
            participant.baseDue += equalShare;
            if (remainder != 0) {
                ++participant.baseDue;
                --remainder;
            }
        }
    }

    function _allocateTip(uint256 billId, uint16 tipBps, uint256 totalTip) private {
        address[] storage participantAddresses = _participants[billId];
        uint256 allocatedTip;
        for (uint256 i; i < participantAddresses.length; ++i) {
            Participant storage participant = _participant[billId][participantAddresses[i]];
            if (!participant.joined) continue;
            uint256 tip = (participant.baseDue * tipBps) / BPS_DENOMINATOR;
            participant.tipDue = tip;
            participant.amountDue = participant.baseDue + tip;
            allocatedTip += tip;
        }

        uint256 tipDust = totalTip - allocatedTip;
        for (uint256 i; i < participantAddresses.length && tipDust != 0; ++i) {
            Participant storage participant = _participant[billId][participantAddresses[i]];
            if (!participant.joined || participant.amountDue == 0) continue;
            ++participant.tipDue;
            ++participant.amountDue;
            --tipDust;
        }
    }

    function _median(uint16[] memory values) private pure returns (uint16) {
        for (uint256 i = 1; i < values.length; ++i) {
            uint16 current = values[i];
            uint256 j = i;
            while (j != 0 && values[j - 1] > current) {
                values[j] = values[j - 1];
                --j;
            }
            values[j] = current;
        }

        uint256 middle = values.length / 2;
        if (values.length % 2 == 1) return values[middle];
        return uint16((uint256(values[middle - 1]) + values[middle]) / 2);
    }
}
