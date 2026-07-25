use std::io::{self, Read};
use shakmaty::{Chess, Position};
use pgn_reader::{BufferedReader, RawHeader, SanPlus, Skip, Visitor};

struct Encoder {
    moves: Vec<u8>,
    pos: Chess,
    skip: bool,
}

impl Encoder {
    fn new() -> Self {
        Self { moves: Vec::new(), pos: Chess::default(), skip: false }
    }

    fn encode_move(&mut self, san_str: &str) {
        let m = match shakmaty::san::SanPlus::from_ascii(san_str.as_bytes()) {
            Ok(s) => s,
            Err(_) => { self.skip = true; return; }
        };
        let legal = self.pos.legal_moves();
        if let Some(idx) = legal.iter().position(|x| {
            shakmaty::san::SanPlus::from_move(self.pos.clone(), &x).to_string() == m.to_string()
        }) {
            self.moves.push(idx as u8);
            self.pos.play_unchecked(&legal[idx]);
        } else {
            self.skip = true;
        }
    }
}

impl Visitor for Encoder {
    type Result = (Vec<u8>, u32);

    fn begin_game(&mut self) {
        self.moves.clear();
        self.pos = Chess::default();
        self.skip = false;
    }

    fn header(&mut self, _key: &[u8], _value: RawHeader<'_>) {
        // standard starting position only — ignore FEN headers
    }

    fn end_headers(&mut self) -> Skip {
        Skip(self.skip)
    }

    fn san(&mut self, san: SanPlus) {
        if !self.skip {
            self.encode_move(&san.to_string());
        }
    }

    fn begin_variation(&mut self) -> Skip {
        Skip(true)
    }

    fn end_game(&mut self) -> Self::Result {
        let ply = self.moves.len() as u32;
        (std::mem::take(&mut self.moves), ply)
    }
}

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();

    let mut reader = BufferedReader::new_cursor(&input[..]);
    let mut encoder = Encoder::new();

    while let Ok(Some((moves, ply))) = reader.read_game(&mut encoder) {
        let hex = moves.iter().map(|b| format!("{}", b)).collect::<Vec<_>>().join(" ");
        println!("PLY {} BYTES {}", ply, moves.len());
        println!("{}", hex);
    }
}
