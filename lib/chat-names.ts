/**
 * The pool `rt chat sign-in` draws an agent's display name from when nothing
 * names it explicitly. Short, common first names, so a human can say "ask
 * fred" and an agent can call itself fred. Every entry is 3 to 6 lowercase
 * letters, so a `-2` display suffix stays legible and no entry reads as one.
 *
 * The draw is least-recently-used over names no live session holds, so a
 * name comes back only after every other name has been drawn once.
 */
export const AGENT_NAMES: readonly string[] = [
  "ada", "abe", "alan", "alex", "alma", "amos", "amy", "andy", "ann", "anya",
  "aria", "arlo", "ava", "axel", "bart", "bea", "beck", "ben", "beth", "bill",
  "blair", "bob", "bram", "bree", "bruno", "bryn", "cal", "cam", "carl", "cass",
  "chad", "chip", "chloe", "clay", "cleo", "clem", "cody", "cole", "cora", "cruz",
  "cyrus", "dale", "dan", "dario", "dave", "dawn", "dean", "dee", "del", "desi",
  "dex", "dina", "dirk", "don", "dot", "doug", "drew", "duke", "earl", "edie",
  "eli", "ella", "elmo", "elsa", "emma", "enzo", "erin", "esme", "ethan", "eva",
  "eve", "ezra", "fay", "felix", "fern", "fin", "fiona", "flo", "fox", "fred",
  "gabe", "gail", "gary", "gene", "gil", "gina", "glen", "greg", "greta", "gus",
  "gwen", "hal", "hana", "hank", "hart", "hattie", "hazel", "heidi", "holly", "hope",
  "hugo", "ida", "ike", "ines", "iris", "isla", "ivy", "jack", "jane", "jasper",
  "jax", "jay", "jed", "jen", "jess", "jill", "jim", "jodi", "joe", "jon",
  "josh", "joy", "jude", "jules", "june", "kai", "kara", "kat", "kay", "kent",
  "kim", "kit", "kurt", "kyle", "lana", "lara", "lars", "lee", "len", "leo",
  "levi", "lex", "lil", "liz", "lola", "lorna", "lou", "lucy", "luke", "lyle",
  "mae", "mark", "mary", "max", "maya", "meg", "mel", "mia", "mike", "milo",
  "moe", "mona", "nadia", "nat", "ned", "nell", "nia", "nick", "noah", "noel",
  "nora", "odin", "olga", "oli", "omar", "opal", "oscar", "otis", "otto", "owen",
  "pam", "pat", "paul", "pearl", "penny", "pete", "phil", "pia", "pip", "quin",
  "rafa", "ray", "reg", "remy", "rene", "rex", "rhea", "rico", "rita", "rob",
  "ron", "rosa", "ross", "roy", "ruby", "russ", "ruth", "ryan", "sage", "sal",
  "sam", "sara", "sean", "seth", "shay", "sid", "sky", "sofia", "stan", "sue",
  "tad", "tamsin", "tara", "tess", "theo", "thora", "tim", "tina", "toby", "todd",
  "tom", "toni", "tyra", "ulla", "uma", "val", "vera", "vic", "viola", "wade",
  "walt", "wanda", "wes", "will", "wren", "xavi", "yuki", "yusuf", "zara", "zed",
  "zelda", "zia", "zoe", "aaron", "abby", "abel", "abram", "ace", "adam", "addie",
  "adele", "adrian", "agnes", "ahmed", "aida", "aiden", "aimee", "aisha", "ajay", "akira",
  "alba", "albert", "alden", "aldo", "alec", "alexa", "alfie", "alfred", "ali", "alice",
  "alina", "alisa", "alison", "allen", "ally", "alvin", "amara", "amber", "amelia", "amir",
  "ana", "andre", "andrea", "angel", "angela", "angie", "anita", "anna", "anne", "annie",
  "anson", "anton", "april", "archie", "ariel", "arjun", "arnav", "arnie", "arthur", "asa",
  "ash", "asher", "ashley", "astrid", "aubrey", "audrey", "august", "aura", "austin", "avery",
  "ayla", "bailey", "barb", "barry", "basil", "baxter", "becca", "bella", "belle", "benny",
  "bernie", "bert", "beryl", "bess", "betsy", "betty", "bianca", "billy", "blake", "bonnie",
  "boyd", "brad", "brady", "brenda", "brent", "brett", "brian", "brock", "brody", "brooke",
  "bruce", "bryce", "burt", "byron", "caleb", "callie", "calvin", "camila", "carla", "carlos",
  "carly", "carmen", "carol", "carrie", "carter", "casey", "cathy", "cecil", "cedric", "celia",
  "chan", "chang", "chase", "cher", "chet", "chris", "chuck", "ciara", "cindy", "claire",
  "clara", "clare", "clark", "claude", "cliff", "clint", "clive", "clyde", "colin", "conor",
  "connie", "corey", "craig", "curt", "cybil", "cyril", "daisy", "dakota", "damon", "dana",
  "daniel", "danny", "daria", "darla", "darren", "daryl", "david", "davis", "dawson", "debby",
  "della", "delia", "denis", "denny", "derek", "devin", "dewey", "diana", "diane", "diego",
  "dixie", "dolly", "donna", "dora", "doris", "drake", "duane", "dudley", "duncan", "dustin",
  "dwight", "dylan", "eamon", "eddie", "edgar", "edith", "edna", "edwin", "effie", "eileen",
  "elaine", "elena", "eliza", "ellen", "ellie", "elliot", "eloise", "elroy", "elvis", "emil",
  "emily", "emmet", "enid", "enoch", "eric", "erica", "ernie", "esther", "ettie", "eunice",
  "evan", "evie", "ewan", "faith", "farah", "faye", "fergus", "finn", "fletch", "flora",
  "floyd", "flynn", "frank", "franny", "freda", "freddy", "frida", "gavin", "gemma", "george",
  "gerald", "gia", "gideon", "gigi", "gilda", "ginny", "giles", "gino", "gladys", "glenda",
  "gloria", "goldie", "gordon", "grace", "grady", "grant", "greer", "gregor", "guy", "hailey",
  "hamza", "hanna", "hannah", "harley", "harold", "harper", "harry", "harvey", "hassan", "hayden",
  "hector", "helen", "helga", "henry", "hilda", "hilary", "homer", "honor", "howard", "hudson",
  "hugh", "hunter", "ian", "igor", "ilsa", "imani", "imogen", "ingrid", "irene", "irma",
  "irving", "isaac", "isaiah", "ismael", "ivan", "izzy", "jackie", "jacob", "jade", "jai",
  "jaime", "jake", "jalen", "james", "jamie", "janet", "janice", "jared", "jason", "javier",
  "jean", "jeff", "jenna", "jerry", "jesse", "jewel", "jin", "joan", "joanne", "jodie",
  "joel", "joey", "john", "johnny", "jolene", "jonah", "jordan", "jose", "joseph", "josie",
  "joyce", "juan", "judith", "judy", "julia", "julian", "julie", "junior", "justin", "kaia",
  "kaleb", "kane", "karen", "karl", "karin", "kate", "katie", "kaya", "keanu", "keira",
  "keith", "kelly", "kelsey", "ken", "kendra", "kenji", "kenny", "kerry", "kevin", "khalid",
  "kian", "kiera", "kira", "kirk", "kitty", "klaus", "kofi", "kris", "kristy", "kya",
  "lacey", "laila", "lance", "landon", "lane", "laura", "lauren", "laurie", "lawson", "layla",
  "leah", "leila", "lena", "leon", "leona", "leroy", "lester", "lewis", "liam", "lila",
  "lily", "linda", "lindy", "lionel", "lisa", "livia", "lloyd", "logan", "lois", "lonnie",
  "lorena", "louie", "louis", "luca", "lucas", "lucia", "luis", "luna", "lydia", "lynn",
  "mabel", "mack", "macy", "madge", "maeve", "maggie", "malia", "malik", "mandy", "manny",
  "marco", "marcus", "margo", "maria", "marie", "marina", "mario", "marisa", "marla", "marlon",
  "martha", "marty", "marvin", "mason", "matteo", "maude", "maura", "mavis", "maxine", "mckay",
  "megan", "melody", "mercy", "mervin", "micah", "miles", "millie", "milton", "mimi", "mina",
  "mindy", "minnie", "miriam", "misty", "mitch", "molly", "monty", "morgan", "morris", "moses",
  "muriel", "myles", "myra", "nancy", "naomi", "nash", "nate", "neil", "nellie", "nelson",
  "nestor", "nigel", "nikki", "nina", "nolan", "norma", "norman", "nova", "olive", "oliver",
  "olivia", "ollie", "orion", "orla", "orson", "ozzie", "paige", "paloma", "pansy", "parker",
  "patty", "paula", "pedro", "peggy", "percy", "perry", "peter", "petra", "phoebe", "piper",
  "polly", "porter", "posey", "priya", "quincy", "quinn", "rachel", "raj", "ralph", "ramon",
  "randy", "raquel", "raven", "reba", "reed", "reese", "regan", "reid", "remi", "rena",
  "reuben", "rhoda", "rhys", "ricky", "riley", "rio", "robin", "rocco", "rocky", "rodney",
  "roger", "rohan", "roland", "rolf", "roman", "romy", "ronan", "ronny", "rory", "rose",
  "rosie", "rowan", "roxy", "rudy", "rufus", "rupert", "ruthie", "ryder", "sabine", "sadie",
  "sally", "salma", "sammy", "sandy", "santi", "sasha", "saul", "scott", "selma", "serena",
  "shane", "shari", "shawn", "sheila", "shelby", "sheri", "sienna", "silas", "simon", "sione",
  "skye", "sonia", "sonny", "sophie", "spike", "stacy", "stella", "steve", "stuart", "sunny",
  "susan", "suzy", "sven", "sybil", "sylvia", "tabby", "talia", "tammy", "tania", "tanner",
  "tasha", "tate", "teddy", "terry", "thea", "thelma", "tilly", "timmy", "tobias", "tomas",
  "tony", "tracy", "travis", "trent", "trevor", "troy", "trudy", "tucker", "tyler", "ursula",
  "vance", "vaughn", "vern", "vicky", "victor", "vince", "vinny", "violet", "vivian", "wally",
  "walter", "warren", "wendy", "wiley", "willa", "willie", "wilma", "wolf", "wyatt", "xander",
  "xena", "yara", "yasmin", "yvette", "yvonne", "zach", "zack", "zane", "zion", "zoey",
  "zola", "abdul", "adina", "afton", "agatha", "alaina", "alani", "alder", "aldous", "aleta",
  "alia", "alvaro", "amani", "amina", "amira", "amya", "anders", "anika", "anneke", "ansel",
  "arden", "ari", "arlen", "arne", "aron", "arturo", "ashton", "aspen", "athena", "aubree",
  "auden", "avi", "axton", "aya", "azra", "basia", "beau", "benji", "bettie", "birdie",
  "bjorn", "blythe", "bodhi", "bonita", "booker", "boris", "brandi", "brandt", "briar", "britt",
  "bronte", "cara", "carina", "carys", "casper", "chaim", "chana", "chaya", "chiara", "cian",
  "clancy", "cleve", "clovis", "colby", "colm", "cooper", "cosmo", "dahlia", "dalia", "damian",
  "dante", "darby", "darcy", "darius", "dasha", "davey", "dayna", "delphi", "demi", "deon",
  "dilys", "dinah", "dion", "donal", "donny", "dovie", "dulce", "dusty", "easton", "eden",
  "edmund", "efrain", "eiko", "elias", "elisa", "elise", "ellis", "elodie", "eloy", "elton",
  "emery", "emrys", "enya", "erik", "ernst", "eshan", "ester", "ethel", "etta", "evelyn",
  "ezio", "fabian", "fallon", "farid", "fatima", "fawn", "felipe", "fenn", "fidel", "filip",
];

/** `fred-2` → `fred`; a bare name is its own base. */
export function baseOfHandle(handle: string): string {
  return handle.replace(/-\d+$/, "");
}

/**
 * The least recently used name no live session holds. `taken` may contain
 * suffixed handles; they exclude their base. `lastUsed` maps a name to when
 * it was last assigned; a name absent from it has never been used and wins
 * outright. Ties are broken uniformly at random. When the whole pool is
 * held, any name is returned and the daemon's suffixing takes over.
 */
export function pickAgentName(
  taken: Iterable<string>,
  lastUsed: Readonly<Record<string, number>>,
  random: () => number = Math.random,
): string {
  const held = new Set<string>();
  for (const h of taken) held.add(baseOfHandle(h));
  const free = AGENT_NAMES.filter((n) => !held.has(n));
  const pool = free.length > 0 ? free : AGENT_NAMES;

  let oldest = Infinity;
  let candidates: string[] = [];
  for (const n of pool) {
    const at = lastUsed[n] ?? -Infinity;
    if (at < oldest) {
      oldest = at;
      candidates = [n];
    } else if (at === oldest) {
      candidates.push(n);
    }
  }
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]!;
}
