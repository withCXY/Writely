// Debug test script for AI Assistant
// 这个脚本可以在浏览器控制台中运行来测试功能

console.log('🧪 AI Assistant Debug Test Starting...');

// 测试Google Docs环境检测
function testGoogleDocsDetection() {
    console.log('--- Google Docs Detection Test ---');
    
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    console.log('Hostname:', hostname);
    console.log('Pathname:', pathname);
    
    // 检查DOM元素
    const elements = {
        '.kix-page-content-wrap': document.querySelector('.kix-page-content-wrap'),
        '[role="textbox"]': document.querySelector('[role="textbox"]'),
        '.kix-appview-editor': document.querySelector('.kix-appview-editor'),
        '.docs-texteventtarget-iframe': document.querySelector('.docs-texteventtarget-iframe'),
        '.kix-canvas-tile-content': document.querySelector('.kix-canvas-tile-content')
    };
    
    console.log('Google Docs Elements Found:');
    Object.entries(elements).forEach(([selector, element]) => {
        console.log(`  ${selector}:`, element ? '✅ Found' : '❌ Not found');
    });
    
    // 模拟isGoogleDocsEnvironment函数
    const isGoogleDocs = (hostname === 'docs.google.com' || hostname.endsWith('.docs.google.com')) &&
        (pathname.includes('/document/') || pathname.includes('/d/') || 
         Object.values(elements).some(el => el !== null));
    
    console.log('Google Docs Environment Detected:', isGoogleDocs ? '✅ Yes' : '❌ No');
    
    return isGoogleDocs;
}

// 测试文本选择
function testTextSelection() {
    console.log('--- Text Selection Test ---');
    
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    console.log('Current Selection:', selectedText || 'No text selected');
    console.log('Selection Range Count:', selection.rangeCount);
    
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        console.log('Selection Rect:', {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
        });
        
        // 测试可编辑元素检测
        const container = range.commonAncestorContainer;
        const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
        
        console.log('Selection Container:', element);
        console.log('Is Editable:', element.isContentEditable || element.tagName === 'TEXTAREA' || element.tagName === 'INPUT');
    }
    
    return selectedText;
}

// 测试扩展状态
function testExtensionStatus() {
    console.log('--- Extension Status Test ---');
    
    // 检查是否有AI Assistant的元素
    const aiElements = {
        'Icon': document.querySelector('#ai-assistant-icon'),
        'Menu': document.querySelector('#ai-assistant-menu'),
        'Alternatives': document.querySelector('#ai-assistant-alternatives')
    };
    
    console.log('AI Assistant Elements:');
    Object.entries(aiElements).forEach(([name, element]) => {
        console.log(`  ${name}:`, element ? '✅ Present' : '❌ Not present');
    });
    
    // 检查Chrome扩展API
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['extensionEnabled', 'googleDocsEnabled'], (result) => {
            console.log('Extension Settings:', result);
        });
    } else {
        console.log('Chrome Extension API: ❌ Not available');
    }
}

// 模拟文本选择事件
function simulateTextSelection(text = 'Test selection') {
    console.log('--- Simulating Text Selection ---');
    
    // 创建一个临时的可编辑元素
    const testElement = document.createElement('div');
    testElement.contentEditable = true;
    testElement.textContent = text;
    testElement.style.cssText = `
        position: fixed;
        top: 50px;
        left: 50px;
        padding: 10px;
        border: 2px solid #4285f4;
        background: #f0f8ff;
        z-index: 999999;
    `;
    
    document.body.appendChild(testElement);
    
    // 选择文本
    const range = document.createRange();
    range.selectNodeContents(testElement);
    
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    
    console.log('Created test element and selected text:', text);
    console.log('You should see a blue box with selected text. Check if AI Assistant icon appears.');
    
    // 5秒后清理
    setTimeout(() => {
        testElement.remove();
        console.log('Test element removed');
    }, 5000);
    
    return testElement;
}

// 运行所有测试
function runAllTests() {
    console.log('🧪 Running All AI Assistant Tests...');
    
    testGoogleDocsDetection();
    testTextSelection();
    testExtensionStatus();
    
    console.log('\n📝 To test text selection:');
    console.log('1. Select some text on this page');
    console.log('2. Or run: simulateTextSelection("Your test text")');
    console.log('3. Check if the blue AI Assistant icon appears');
    
    console.log('\n🔧 Debug Commands:');
    console.log('- testGoogleDocsDetection() - Test Google Docs detection');
    console.log('- testTextSelection() - Test current text selection');
    console.log('- testExtensionStatus() - Check extension status');
    console.log('- simulateTextSelection() - Create test selection');
}

// 自动运行测试
runAllTests();

// 导出函数到全局作用域以便在控制台中使用
window.aiAssistantDebug = {
    testGoogleDocsDetection,
    testTextSelection,
    testExtensionStatus,
    simulateTextSelection,
    runAllTests
};

console.log('🧪 Debug functions available as window.aiAssistantDebug');