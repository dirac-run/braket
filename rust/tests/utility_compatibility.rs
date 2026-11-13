mod support;
use braket::classify;

#[test]
fn dirac_examples_and_independent_utility_boundaries() {
    let cases = support::fixtures(include_str!("fixtures/utility-compatibility.tsv"));
    assert_eq!(cases.len(), 238);
    for (expected, command) in cases {
        assert_eq!(classify(&command), expected, "{command}");
    }
}
