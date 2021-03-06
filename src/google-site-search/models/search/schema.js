
export default [`
  type SSSearchResult {
    id: ID
    title: String
    htmlTitle: String
    link: String
    displayLink: String
    description: String
    htmlDescription: String
    type: String
    section: String
    image: String
  }

  type SSSearch {
    total: Int
    next: Int
    previous: Int
    items: [SSSearchResult]
  }
`];
