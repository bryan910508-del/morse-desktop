// The account's channel list cannot be consulted at this moment — it is being read, the window is away, or the
// screen is locked. A holder of a channel surface waits for the list instead of concluding that the channel is
// not one of this account's, which is a different answer and a permanent one.
export class ChannelListUnavailable extends Error {}
