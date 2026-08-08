// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CrowdCart
/// @notice Escrows fixed maximum-price deposits for time-limited group purchases.
/// @dev Every successful buyer pays the same price: the lowest tier unlocked by
///      the final buyer count. Refunds and merchant proceeds use pull payments.
contract CrowdCart {
    uint256 public constant MAX_TIERS = 16;

    enum DealState {
        None,
        Active,
        Successful,
        Cancelled,
        Failed
    }

    struct Deal {
        address payable merchant;
        string metadataURI;
        uint64 createdAt;
        uint64 endsAt;
        uint32 minBuyers;
        uint32 maxBuyers;
        uint32 buyerCount;
        uint96 maxPrice;
        uint96 clearingPrice;
        DealState state;
        bool proceedsWithdrawn;
        uint32[] thresholds;
        uint96[] prices;
    }

    /// @notice A UI-friendly snapshot of a deal. `currentPrice` is the price
    ///         unlocked by the current buyer count, or the settled price after
    ///         a successful finalisation.
    struct DealView {
        uint256 id;
        address merchant;
        string metadataURI;
        uint64 createdAt;
        uint64 endsAt;
        uint32 minBuyers;
        uint32 maxBuyers;
        uint32 buyerCount;
        uint96 maxPrice;
        uint96 currentPrice;
        uint96 clearingPrice;
        DealState state;
        bool canFinalise;
        bool proceedsWithdrawn;
    }

    error DealNotFound();
    error DealNotActive();
    error DealNotSettled();
    error DealStillOpen();
    error InvalidDeadline();
    error InvalidBuyerLimits();
    error InvalidTierCount();
    error InvalidTierThresholds();
    error InvalidTierPrices();
    error NotMerchant();
    error MerchantCannotJoin();
    error DealAlreadyJoined();
    error DealSoldOut();
    error IncorrectDeposit(uint256 expected, uint256 received);
    error NotParticipant();
    error RefundAlreadyClaimed();
    error NoRefundAvailable();
    error NoProceedsAvailable();
    error TransferFailed();
    error Reentrancy();

    event DealCreated(
        uint256 indexed dealId,
        address indexed merchant,
        uint64 endsAt,
        uint32 minBuyers,
        uint32 maxBuyers,
        uint96 maxPrice,
        string metadataURI
    );
    event DealJoined(
        uint256 indexed dealId,
        address indexed buyer,
        uint32 buyerCount,
        uint96 currentPrice
    );
    event DealFinalised(
        uint256 indexed dealId,
        bool successful,
        uint32 buyerCount,
        uint96 clearingPrice,
        uint256 merchantProceeds
    );
    event DealCancelled(uint256 indexed dealId, address indexed merchant);
    event RefundClaimed(uint256 indexed dealId, address indexed buyer, uint256 amount);
    event ProceedsWithdrawn(uint256 indexed dealId, address indexed merchant, uint256 amount);

    uint256 public dealCount;

    mapping(uint256 dealId => Deal deal) private _deals;
    mapping(uint256 dealId => mapping(address buyer => bool joined)) private _joined;
    mapping(uint256 dealId => mapping(address buyer => bool claimed)) private _refundClaimed;

    uint256 private _unlocked = 1;

    modifier nonReentrant() {
        if (_unlocked != 1) revert Reentrancy();
        _unlocked = 2;
        _;
        _unlocked = 1;
    }

    /// @notice Creates a deal with ascending buyer thresholds and strictly
    ///         falling unit prices. The first threshold must be one.
    /// @param metadataURI Product metadata or a conventional URL.
    /// @param endsAt Unix timestamp at which normal joining closes.
    /// @param minBuyers Minimum buyers required for a successful deal.
    /// @param maxBuyers Maximum number of buyer wallets accepted.
    /// @param thresholds Buyer counts at which each price becomes active.
    /// @param prices Unit prices corresponding to `thresholds`.
    function createDeal(
        string calldata metadataURI,
        uint64 endsAt,
        uint32 minBuyers,
        uint32 maxBuyers,
        uint32[] calldata thresholds,
        uint96[] calldata prices
    ) external returns (uint256 dealId) {
        if (endsAt <= block.timestamp) revert InvalidDeadline();
        if (minBuyers == 0 || maxBuyers < minBuyers) revert InvalidBuyerLimits();

        uint256 tierCount = thresholds.length;
        if (tierCount == 0 || tierCount != prices.length || tierCount > MAX_TIERS) {
            revert InvalidTierCount();
        }
        if (thresholds[0] != 1 || thresholds[tierCount - 1] > maxBuyers) {
            revert InvalidTierThresholds();
        }
        if (prices[0] == 0) revert InvalidTierPrices();

        for (uint256 i = 1; i < tierCount; ++i) {
            if (thresholds[i] <= thresholds[i - 1]) revert InvalidTierThresholds();
            if (prices[i] == 0 || prices[i] >= prices[i - 1]) revert InvalidTierPrices();
        }

        dealId = ++dealCount;
        Deal storage deal = _deals[dealId];
        deal.merchant = payable(msg.sender);
        deal.metadataURI = metadataURI;
        deal.createdAt = uint64(block.timestamp);
        deal.endsAt = endsAt;
        deal.minBuyers = minBuyers;
        deal.maxBuyers = maxBuyers;
        deal.maxPrice = prices[0];
        deal.state = DealState.Active;

        for (uint256 i; i < tierCount; ++i) {
            deal.thresholds.push(thresholds[i]);
            deal.prices.push(prices[i]);
        }

        _emitDealCreated(dealId, deal);
    }

    /// @notice Joins an active deal by depositing its exact maximum price.
    /// @dev One wallet represents one buyer and may join each deal once.
    function joinDeal(uint256 dealId) external payable {
        Deal storage deal = _dealOrRevert(dealId);
        if (deal.state != DealState.Active || block.timestamp >= deal.endsAt) {
            revert DealNotActive();
        }
        if (msg.sender == deal.merchant) revert MerchantCannotJoin();
        if (_joined[dealId][msg.sender]) revert DealAlreadyJoined();
        if (deal.buyerCount == deal.maxBuyers) revert DealSoldOut();
        if (msg.value != deal.maxPrice) revert IncorrectDeposit(deal.maxPrice, msg.value);

        _joined[dealId][msg.sender] = true;
        uint32 newBuyerCount = ++deal.buyerCount;

        emit DealJoined(dealId, msg.sender, newBuyerCount, _priceForCount(deal, newBuyerCount));
    }

    /// @notice Finalises a deal after its deadline, or earlier when sold out.
    /// @dev Anyone may call this so a missing merchant cannot lock buyer funds.
    function finaliseDeal(uint256 dealId) external {
        Deal storage deal = _dealOrRevert(dealId);
        if (deal.state != DealState.Active) revert DealNotActive();
        if (block.timestamp < deal.endsAt && deal.buyerCount < deal.maxBuyers) {
            revert DealStillOpen();
        }

        bool successful = deal.buyerCount >= deal.minBuyers;
        uint96 clearingPrice;
        uint256 merchantProceeds;

        if (successful) {
            clearingPrice = _priceForCount(deal, deal.buyerCount);
            merchantProceeds = uint256(clearingPrice) * deal.buyerCount;
            deal.clearingPrice = clearingPrice;
            deal.state = DealState.Successful;
        } else {
            deal.state = DealState.Failed;
        }

        emit DealFinalised(
            dealId,
            successful,
            deal.buyerCount,
            clearingPrice,
            merchantProceeds
        );
    }

    /// @notice Cancels an unsettled deal. Joined buyers then reclaim full deposits.
    function cancelDeal(uint256 dealId) external {
        Deal storage deal = _dealOrRevert(dealId);
        if (msg.sender != deal.merchant) revert NotMerchant();
        if (deal.state != DealState.Active) revert DealNotActive();

        deal.state = DealState.Cancelled;
        emit DealCancelled(dealId, msg.sender);
    }

    /// @notice Pulls the caller's price-difference or full cancellation refund.
    function claimRefund(uint256 dealId) external nonReentrant {
        Deal storage deal = _dealOrRevert(dealId);
        if (deal.state == DealState.Active) revert DealNotSettled();
        if (!_joined[dealId][msg.sender]) revert NotParticipant();
        if (_refundClaimed[dealId][msg.sender]) revert RefundAlreadyClaimed();

        uint256 amount = _claimableRefund(dealId, deal, msg.sender);
        if (amount == 0) revert NoRefundAvailable();

        _refundClaimed[dealId][msg.sender] = true;
        (bool sent, ) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit RefundClaimed(dealId, msg.sender, amount);
    }

    /// @notice Pulls all proceeds from a successful deal to its merchant.
    function withdrawProceeds(uint256 dealId) external nonReentrant {
        Deal storage deal = _dealOrRevert(dealId);
        if (msg.sender != deal.merchant) revert NotMerchant();

        uint256 amount = merchantProceedsAvailable(dealId);
        if (amount == 0) revert NoProceedsAvailable();

        deal.proceedsWithdrawn = true;
        (bool sent, ) = deal.merchant.call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit ProceedsWithdrawn(dealId, msg.sender, amount);
    }

    /// @notice Returns the deal's complete summary for display clients.
    function getDeal(uint256 dealId) external view returns (DealView memory view_) {
        Deal storage deal = _dealOrRevert(dealId);
        view_ = DealView({
            id: dealId,
            merchant: deal.merchant,
            metadataURI: deal.metadataURI,
            createdAt: deal.createdAt,
            endsAt: deal.endsAt,
            minBuyers: deal.minBuyers,
            maxBuyers: deal.maxBuyers,
            buyerCount: deal.buyerCount,
            maxPrice: deal.maxPrice,
            currentPrice: currentPrice(dealId),
            clearingPrice: deal.clearingPrice,
            state: deal.state,
            canFinalise: _canFinalise(deal),
            proceedsWithdrawn: deal.proceedsWithdrawn
        });
    }

    /// @notice Returns tier thresholds and prices in matching array positions.
    function getTiers(
        uint256 dealId
    ) external view returns (uint32[] memory thresholds, uint96[] memory prices) {
        Deal storage deal = _dealOrRevert(dealId);
        return (deal.thresholds, deal.prices);
    }

    /// @notice Returns the projected live unit price or the final clearing price.
    function currentPrice(uint256 dealId) public view returns (uint96) {
        Deal storage deal = _dealOrRevert(dealId);
        if (deal.state == DealState.Successful) return deal.clearingPrice;
        return _priceForCount(deal, deal.buyerCount);
    }

    /// @notice Returns a buyer's participation and refund state.
    function getBuyer(
        uint256 dealId,
        address buyer
    ) external view returns (bool joined, bool refundClaimed, uint256 refundAvailable) {
        Deal storage deal = _dealOrRevert(dealId);
        joined = _joined[dealId][buyer];
        refundClaimed = _refundClaimed[dealId][buyer];
        refundAvailable = _claimableRefund(dealId, deal, buyer);
    }

    /// @notice Returns the refund a buyer can pull right now.
    function claimableRefund(uint256 dealId, address buyer) external view returns (uint256) {
        Deal storage deal = _dealOrRevert(dealId);
        return _claimableRefund(dealId, deal, buyer);
    }

    /// @notice Returns merchant proceeds that remain available to withdraw.
    function merchantProceedsAvailable(uint256 dealId) public view returns (uint256) {
        Deal storage deal = _dealOrRevert(dealId);
        if (deal.state != DealState.Successful || deal.proceedsWithdrawn) return 0;
        return uint256(deal.clearingPrice) * deal.buyerCount;
    }

    /// @notice Previews whether finalisation is available and its current outcome.
    function previewFinalisation(
        uint256 dealId
    )
        external
        view
        returns (
            bool canFinaliseNow,
            bool wouldSucceed,
            uint96 projectedClearingPrice,
            uint256 projectedMerchantProceeds
        )
    {
        Deal storage deal = _dealOrRevert(dealId);
        canFinaliseNow = _canFinalise(deal);
        wouldSucceed = deal.state == DealState.Active && deal.buyerCount >= deal.minBuyers;

        if (wouldSucceed) {
            projectedClearingPrice = _priceForCount(deal, deal.buyerCount);
            projectedMerchantProceeds = uint256(projectedClearingPrice) * deal.buyerCount;
        }
    }

    function _dealOrRevert(uint256 dealId) internal view returns (Deal storage deal) {
        deal = _deals[dealId];
        if (deal.state == DealState.None) revert DealNotFound();
    }

    function _emitDealCreated(uint256 dealId, Deal storage deal) internal {
        emit DealCreated(
            dealId,
            deal.merchant,
            deal.endsAt,
            deal.minBuyers,
            deal.maxBuyers,
            deal.maxPrice,
            deal.metadataURI
        );
    }

    function _priceForCount(Deal storage deal, uint32 buyerCount) internal view returns (uint96 price) {
        price = deal.maxPrice;
        uint256 tierCount = deal.thresholds.length;

        for (uint256 i = 1; i < tierCount; ++i) {
            if (buyerCount < deal.thresholds[i]) break;
            price = deal.prices[i];
        }
    }

    function _claimableRefund(
        uint256 dealId,
        Deal storage deal,
        address buyer
    ) internal view returns (uint256) {
        if (!_joined[dealId][buyer] || _refundClaimed[dealId][buyer]) return 0;

        if (deal.state == DealState.Cancelled || deal.state == DealState.Failed) {
            return deal.maxPrice;
        }
        if (deal.state == DealState.Successful) {
            return uint256(deal.maxPrice) - deal.clearingPrice;
        }
        return 0;
    }

    function _canFinalise(Deal storage deal) internal view returns (bool) {
        return
            deal.state == DealState.Active &&
            (block.timestamp >= deal.endsAt || deal.buyerCount == deal.maxBuyers);
    }
}
