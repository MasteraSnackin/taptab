// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICrowdCartRefunds {
    function createDeal(
        string calldata metadataURI,
        uint64 endsAt,
        uint32 minBuyers,
        uint32 maxBuyers,
        uint32[] calldata thresholds,
        uint96[] calldata prices
    ) external returns (uint256 dealId);

    function joinDeal(uint256 dealId) external payable;

    function claimRefund(uint256 dealId) external;

    function withdrawProceeds(uint256 dealId) external;
}

/// @dev Test-only buyer used to exercise failed transfers and reentrancy.
contract RefundReceiver {
    ICrowdCartRefunds public immutable crowdCart;
    uint256 public dealId;
    bool public rejectPayments;
    bool public attemptReentrancy;
    bool public reentrancyWasBlocked;

    constructor(address crowdCart_) {
        crowdCart = ICrowdCartRefunds(crowdCart_);
    }

    function create(
        string calldata metadataURI,
        uint64 endsAt,
        uint32 minBuyers,
        uint32 maxBuyers,
        uint32[] calldata thresholds,
        uint96[] calldata prices
    ) external returns (uint256 dealId_) {
        dealId_ = crowdCart.createDeal(
            metadataURI,
            endsAt,
            minBuyers,
            maxBuyers,
            thresholds,
            prices
        );
        dealId = dealId_;
    }

    function join(uint256 dealId_) external payable {
        dealId = dealId_;
        crowdCart.joinDeal{value: msg.value}(dealId_);
    }

    function claim() external {
        crowdCart.claimRefund(dealId);
    }

    function withdraw() external {
        crowdCart.withdrawProceeds(dealId);
    }

    function configure(bool rejectPayments_, bool attemptReentrancy_) external {
        rejectPayments = rejectPayments_;
        attemptReentrancy = attemptReentrancy_;
    }

    receive() external payable {
        if (rejectPayments) revert("PAYMENT_REJECTED");

        if (attemptReentrancy && !reentrancyWasBlocked) {
            (bool succeeded, ) = address(crowdCart).call(
                abi.encodeWithSelector(ICrowdCartRefunds.claimRefund.selector, dealId)
            );
            reentrancyWasBlocked = !succeeded;
        }
    }
}
