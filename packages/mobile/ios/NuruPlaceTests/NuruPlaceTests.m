#import <UIKit/UIKit.h>
#import <XCTest/XCTest.h>

@interface NuruPlaceTests : XCTestCase
@end

@implementation NuruPlaceTests

- (void)testSceneCreatesAVisibleRootWindow
{
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:15];
  UIWindow *window = nil;
  while ([deadline timeIntervalSinceNow] > 0) {
    window = [UIApplication sharedApplication].delegate.window;
    if (window.windowScene != nil && window.rootViewController != nil && !window.hidden) break;
    [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }

  XCTAssertNotNil(window.windowScene, @"The app must attach its window to an iOS scene.");
  XCTAssertNotNil(window.rootViewController, @"The app must install its React Native root controller.");
  XCTAssertFalse(window.hidden, @"The app's root window must be visible.");
}

@end
