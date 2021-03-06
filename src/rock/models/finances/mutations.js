
export default [

  `syncTransactions(
    condition: String,
    transaction_type: String,
    action_type: String,
    transaction_id: String,
    order_id: String,
    last_name: String,
    email: String,
    start_date: String,
    end_date: String,
    personId: Int,
    gateway: String = "NMI Gateway",
  ): [Transaction]`,

  `createOrder(
    data: String!
    id: ID
    instant: Boolean = false,
    gateway: String = "NMI Gateway",
    url: String
  ): OrderMutationResponse`,

  `completeOrder(
    token: ID!
    scheduleId: ID
    accountName: String
    gateway: String = "NMI Gateway",
  ): CompleteOrderMutationResponse`,

  `validate(
    token: ID!
    gateway: String = "NMI Gateway",
  ): ValidateMutationResponse`,

  `cancelSavedPayment(
    id: ID
    entityId: Int
    gateway: String = "NMI Gateway",
  ): SavePaymentMutationResponse`,

  `savePayment(
    token: ID!
    accountName: String
    gateway: String = "NMI Gateway",
  ): SavePaymentMutationResponse`,

  `updateSavedPayment(
    entityId: Int
    name: String!
  ): SavePaymentMutationResponse`,

  `cancelSchedule(
    id: ID
    entityId: Int
    gateway: String = "NMI Gateway",
  ): ScheduledTransactionMutationResponse`,

  `transactionStatement(
    limit: Int
    skip: Int
    people: [Int]
    start: String
    end: String
  ): StatementMutationResponse`
];
